/* Pure helpers shared by the webview (window.ConfigEditorUtil) and the unit tests (module.exports). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConfigEditorUtil = api;
})(typeof self !== "undefined" ? self : this, function () {
  const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

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

  /* ── primitive arrays as comma-separated text ──
     Items containing commas, quotes or edge whitespace are written as JSON strings ("a, b").
     How unquoted items are read depends on the array's kind:
       "string" – always strings
       "number" – numbers where possible, otherwise strings
       "mixed"  – null / true / false / numbers are literals, anything else is a string */

  function arrayKind(arr) {
    if (arr.length && arr.every((x) => typeof x === "string")) return "string";
    if (arr.length && arr.every((x) => typeof x === "number")) return "number";
    return "mixed";
  }

  function isLiteral(s) {
    return s === "null" || s === "true" || s === "false" || NUMBER_RE.test(s);
  }

  function formatItem(x, kind) {
    if (typeof x !== "string") return String(x);
    const needsQuotes =
      x === "" ||
      x !== x.trim() ||
      /[",\n\r]/.test(x) ||
      (kind !== "string" && isLiteral(x));
    return needsQuotes ? JSON.stringify(x) : x;
  }

  function formatArray(arr, kind) {
    return arr.map((x) => formatItem(x, kind)).join(", ");
  }

  function parseToken(tok, kind) {
    if (kind === "string") return tok;
    if (NUMBER_RE.test(tok)) return Number(tok);
    if (kind === "number") return tok;
    if (tok === "null") return null;
    if (tok === "true") return true;
    if (tok === "false") return false;
    return tok;
  }

  /** Returns { ok: true, value } or { ok: false, error } */
  function parseArray(text, kind) {
    const out = [];
    const n = text.length;
    let i = 0;
    const skipWs = () => {
      while (i < n && /\s/.test(text[i])) i++;
    };

    while (i < n) {
      skipWs();
      if (text[i] === '"') {
        let j = i + 1;
        while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        if (j >= n) return { ok: false, error: "Unterminated quote" };
        try {
          out.push(JSON.parse(text.slice(i, j + 1)));
        } catch {
          return { ok: false, error: "Invalid quoted item " + text.slice(i, j + 1) };
        }
        i = j + 1;
        skipWs();
        if (i < n && text[i] !== ",") {
          return { ok: false, error: "Expected a comma after " + text.slice(0, i).trim().slice(-20) };
        }
      } else {
        let j = text.indexOf(",", i);
        if (j === -1) j = n;
        const tok = text.slice(i, j).trim();
        if (tok) out.push(parseToken(tok, kind));
        i = j;
      }
      i++; // skip the comma
    }
    return { ok: true, value: out };
  }

  return {
    isPlainObject,
    isMatrixDef,
    isPrimitiveArray,
    getAtPath,
    setAtPath,
    pathId,
    coerce,
    arrayKind,
    formatArray,
    parseArray,
  };
});
