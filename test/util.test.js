const test = require("node:test");
const assert = require("node:assert/strict");
const util = require("../media/util.js");

test("coerce keeps the original value's type", () => {
  assert.equal(util.coerce("42", 7), 42);
  assert.equal(util.coerce("-1.5e3", 7), -1500);
  assert.equal(util.coerce("4a", 7), "4a");
  assert.equal(util.coerce("", 7), "");
  assert.equal(util.coerce("false", true), false);
  assert.equal(util.coerce("maybe", true), "maybe");
  assert.equal(util.coerce("", null), null);
  assert.equal(util.coerce("x", null), "x");
  assert.equal(util.coerce("42", "s"), "42");
});

test("pathId distinguishes dotted keys from nesting", () => {
  assert.notEqual(util.pathId(["a.b"]), util.pathId(["a", "b"]));
  assert.notEqual(util.pathId(["0"]), util.pathId([0]));
});

test("getAtPath / setAtPath", () => {
  const o = { a: { b: [1, { c: 2 }] } };
  assert.equal(util.getAtPath(o, ["a", "b", 1, "c"]), 2);
  assert.equal(util.getAtPath(o, ["x", "y"]), undefined);
  util.setAtPath(o, ["a", "b", 0], 9);
  assert.deepEqual(o.a.b, [9, { c: 2 }]);
});

test("isMatrixDef requires array labels and values", () => {
  assert.ok(util.isMatrixDef({ labels_rows: [], labels_cols: [], values: [] }));
  assert.ok(!util.isMatrixDef({ labels_rows: "a", labels_cols: [], values: [] }));
  assert.ok(!util.isMatrixDef([1]));
});

test("arrayKind", () => {
  assert.equal(util.arrayKind(["a", "1"]), "string");
  assert.equal(util.arrayKind([1, 2]), "number");
  assert.equal(util.arrayKind([1, "a"]), "mixed");
  assert.equal(util.arrayKind([]), "mixed");
});

function roundTrip(arr) {
  const kind = util.arrayKind(arr);
  const parsed = util.parseArray(util.formatArray(arr, kind), kind);
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual(parsed.value, arr);
}

test("primitive arrays round-trip through text", () => {
  roundTrip(["a", "b c", "8080", "null", "true"]);
  roundTrip(["has, comma", 'has "quote"', " padded ", "", "multi\nline"]);
  roundTrip([1, 2.5, -3e2, 0]);
  roundTrip([1, "1", null, true, false, "null", "x, y"]);
  roundTrip([]);
});

test("string arrays keep numeric-looking items unquoted", () => {
  assert.equal(util.formatArray(["8080", "443"], "string"), "8080, 443");
});

test("parseArray reads unquoted items by array kind", () => {
  assert.deepEqual(util.parseArray("1, 2, x", "number").value, [1, 2, "x"]);
  assert.deepEqual(util.parseArray("1, null, true, x", "mixed").value, [1, null, true, "x"]);
  assert.deepEqual(util.parseArray("1, null", "string").value, ["1", "null"]);
});

test("parseArray tolerates empty items and whitespace", () => {
  assert.deepEqual(util.parseArray("a,, b ,", "string").value, ["a", "b"]);
  assert.deepEqual(util.parseArray("   ", "string").value, []);
  assert.deepEqual(util.parseArray('"a, b" , c', "string").value, ["a, b", "c"]);
});

test("parseArray reports malformed quoting", () => {
  assert.equal(util.parseArray('"abc', "string").ok, false);
  assert.equal(util.parseArray('"a" b', "string").ok, false);
});
