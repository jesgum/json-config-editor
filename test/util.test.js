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

test("emptyLike keeps the type of the previous entry", () => {
  assert.equal(util.emptyLike("Other"), "");
  assert.equal(util.emptyLike(5), 0);
  assert.equal(util.emptyLike(true), false);
  assert.equal(util.emptyLike(null), null);
  assert.equal(util.emptyLike(undefined), "");
});

test("searchData finds nested keys and values and marks their parents", () => {
  const data = {
    server: { http: { timeout: 30, host: "localhost" } },
    other: { name: "x" },
  };
  const id = util.pathId;

  const byKey = util.searchData(data, "TIME");
  assert.deepEqual([...byKey.hits], [[id(["server", "http", "timeout"]), "key"]]);
  assert.ok(byKey.parents.has(id(["server"])));
  assert.ok(byKey.parents.has(id(["server", "http"])));
  assert.ok(!byKey.visible.has(id(["server", "http", "host"])));
  assert.ok(!byKey.visible.has(id(["other"])));

  const byValue = util.searchData(data, "local");
  assert.deepEqual([...byValue.hits], [[id(["server", "http", "host"]), "value"]]);

  // everything inside a hit stays visible
  const byParent = util.searchData(data, "http");
  assert.ok(byParent.visible.has(id(["server", "http", "host"])));
  assert.ok(!byParent.parents.has(id(["server", "http"])));
});

test("searchData matches dotted queries against the path", () => {
  const data = { a: { b: { c: 1 } }, c: 2 };
  const { hits } = util.searchData(data, "b.c");
  assert.deepEqual([...hits.keys()], [util.pathId(["a", "b", "c"])]);
});

test("searchData ignores array indices and matrix internals as keys", () => {
  const data = {
    list: ["one", "two"],
    m: { labels_rows: ["r"], labels_cols: ["values"], values: [["1"]] },
  };
  const id = util.pathId;
  assert.deepEqual([...util.searchData(data, "1").hits], [[id(["m", "values", 0, 0]), "value"]]);
  assert.deepEqual([...util.searchData(data, "values").hits], [[id(["m", "labels_cols", 0]), "value"]]);
  assert.deepEqual([...util.searchData(data, "two").hits], [[id(["list", 1]), "value"]]);
  assert.equal(util.searchData(data, "  ").hits.size, 0);
});

test("diffData matches objects by key and arrays by index", () => {
  const d = util.diffData(
    { a: 1, b: { c: "x", d: [1, 2] }, gone: true },
    { a: 1, b: { c: "y", d: [1, 2, 3] }, extra: { n: 1 } }
  );
  assert.equal(d.status, "changed");
  assert.deepEqual(d.children.map((c) => [c.key, c.node.status]), [
    ["a", "same"],
    ["b", "changed"],
    ["gone", "removed"],
    ["extra", "added"],
  ]);
  const b = d.children[1].node;
  assert.equal(b.changes, 2);
  assert.deepEqual(b.children[0].node, { status: "changed", left: "x", right: "y", changes: 1 });
  const arr = b.children[1].node;
  assert.ok(arr.array);
  assert.deepEqual(arr.children.map((c) => [c.key, c.node.status]), [[0, "same"], [1, "same"], [2, "added"]]);
  // a subtree that exists on one side only can still be browsed
  assert.deepEqual(d.children[3].node.children, [{ key: "n", node: { status: "added", right: 1, changes: 1 } }]);
  assert.equal(d.changes, 4);
});

test("diffData treats type changes as one changed value", () => {
  assert.equal(util.diffData({ a: "1" }, { a: 1 }).children[0].node.status, "changed");
  const t = util.diffData({ a: { x: 1 } }, { a: [1] }).children[0].node;
  assert.equal(t.status, "changed");
  assert.equal(t.children, undefined);
  assert.equal(util.diffData({ a: [{ x: 1 }] }, { a: [{ x: 1 }] }).status, "same");
  assert.equal(util.diffData({}, {}).status, "same");
});
