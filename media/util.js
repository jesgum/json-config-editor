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

  return {
    searchData,
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
