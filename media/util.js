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

  return {
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
