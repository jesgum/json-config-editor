/* Pure helpers shared by the webview (window.ConfigEditorUtil) and the unit tests (module.exports). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConfigEditorUtil = api;
})(typeof self !== "undefined" ? self : this, function () {
  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isMatrixDef(v) {
    return (
      isPlainObject(v) &&
      Array.isArray(v.labels_rows) &&
      Array.isArray(v.labels_cols) &&
      Array.isArray(v.values)
    );
  }

  function isPrimitiveArray(arr) {
    return arr.every(
      (x) =>
        typeof x === "string" ||
        typeof x === "number" ||
        typeof x === "boolean" ||
        x === null
    );
  }

  function getAtPath(obj, path) {
    return path.reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function setAtPath(obj, path, val) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = val;
  }

  /** Stable id for a path; JSON so that keys containing "." can't collide */
  function pathId(path) {
    return JSON.stringify(path);
  }

  /** Convert input text back to the type of the value it replaces */
  function coerce(text, original) {
    if (typeof original === "number") {
      const n = Number(text);
      if (text.trim() !== "" && Number.isFinite(n)) return n;
    } else if (typeof original === "boolean") {
      if (text === "true") return true;
      if (text === "false") return false;
    } else if (original === null && text === "") {
      return null;
    }
    return text;
  }

  /** A blank value of the same type, used for a newly added list entry */
  function emptyLike(v) {
    if (typeof v === "number") return 0;
    if (typeof v === "boolean") return false;
    if (v === null) return null;
    return "";
  }

  /**
   * Search keys and primitive values below the root object.
   * A query containing "." is matched against the dotted path instead of the key.
   * Returns pathIds: hits (id → "key" | "value"), parents (nodes with a hit below)
   * and visible (hits, their parents and everything inside a hit).
   */
  function searchData(data, query) {
    const q = query.trim().toLowerCase();
    const hits = new Map();
    const parents = new Set();
    const visible = new Set();
    if (!q || !isPlainObject(data)) return { hits, parents, visible };
    const byPath = q.includes(".");

    function valueHit(v) {
      return (
        (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
        String(v).toLowerCase().includes(q)
      );
    }

    // keyed: false for array entries and matrix internals, whose "key" is an index
    function walk(value, path, keyed, inside) {
      const id = pathId(path);
      const name = byPath ? path.join(".") : String(path[path.length - 1]);
      let kind = null;
      if (keyed && name.toLowerCase().includes(q)) kind = "key";
      else if (valueHit(value)) kind = "value";
      if (kind) hits.set(id, kind);

      const inner = inside || kind !== null;
      let below = false;
      const visit = (v, p, k) => {
        if (walk(v, p, k, inner)) below = true;
      };
      if (isMatrixDef(value)) {
        value.labels_rows.forEach((v, i) => visit(v, path.concat("labels_rows", i), false));
        value.labels_cols.forEach((v, j) => visit(v, path.concat("labels_cols", j), false));
        value.values.forEach((row, i) => {
          if (Array.isArray(row)) row.forEach((v, j) => visit(v, path.concat("values", i, j), false));
        });
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, path.concat(i), false));
      } else if (isPlainObject(value)) {
        Object.keys(value).forEach((k) => visit(value[k], path.concat(k), true));
      }

      if (below) parents.add(id);
      if (kind || below || inside) visible.add(id);
      return kind !== null || below;
    }

    Object.keys(data).forEach((k) => walk(data[k], [k], true, false));
    return { hits, parents, visible };
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ka = Object.keys(a);
      return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && deepEqual(a[k], b[k]));
    }
    return false;
  }

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function isContainer(v) {
    return Array.isArray(v) || isPlainObject(v);
  }

  /** A value that exists on one side only; containers keep their children so they can be browsed */
  function oneSided(value, status) {
    const node = { status, changes: 1 };
    node[status === "added" ? "right" : "left"] = value;
    if (isContainer(value)) {
      node.array = Array.isArray(value);
      node.children = Object.keys(value).map((k) => ({
        key: node.array ? Number(k) : k,
        node: oneSided(value[k], status),
      }));
    }
    return node;
  }

  /**
   * Compare two values. Objects are matched by key (left order first, then keys only on the right),
   * arrays by index. Returns { status: "same" | "changed" | "added" | "removed", left, right,
   * changes (number of differing fields below), array, children: [{ key, node }] }.
   * A container on one side and a different type on the other is a single changed value.
   */
  function diffData(left, right) {
    const bothArrays = Array.isArray(left) && Array.isArray(right);
    if (!bothArrays && !(isPlainObject(left) && isPlainObject(right))) {
      const same = deepEqual(left, right);
      return { status: same ? "same" : "changed", left, right, changes: same ? 0 : 1 };
    }
    let keys;
    if (bothArrays) {
      keys = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => i);
    } else {
      keys = Object.keys(left).concat(Object.keys(right).filter((k) => !has(left, k)));
    }
    let changes = 0;
    const children = keys.map((k) => {
      let node;
      if (!has(left, k)) node = oneSided(right[k], "added");
      else if (!has(right, k)) node = oneSided(left[k], "removed");
      else node = diffData(left[k], right[k]);
      changes += node.changes;
      return { key: k, node };
    });
    return { status: changes ? "changed" : "same", left, right, changes, array: bothArrays, children };
  }

  return {
    searchData,
    diffData,
    deepEqual,
    isPlainObject,
    isMatrixDef,
    isPrimitiveArray,
    getAtPath,
    setAtPath,
    pathId,
    coerce,
    emptyLike,
  };
});
