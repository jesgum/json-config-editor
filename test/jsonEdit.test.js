const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDocument,
  detectFormatting,
  applyDataChange,
  minimalReplacement,
  deepEqual,
} = require("../out/jsonEdit.js");

function edit(text, mutate) {
  const { data } = parseDocument(text);
  const next = structuredClone(data);
  mutate(next);
  return applyDataChange(text, data, next, detectFormatting(text));
}

test("parseDocument handles empty, invalid and JSONC input", () => {
  assert.deepEqual(parseDocument("  \n"), { empty: true });
  assert.match(parseDocument('{\n  "a": }').error, /line 2/);
  assert.deepEqual(parseDocument('{ // c\n "a": 1, /* d */ "b": [2,], }').data, { a: 1, b: [2] });
});

test("detectFormatting", () => {
  assert.deepEqual(detectFormatting('{\n    "a": 1\n}'), { insertSpaces: true, tabSize: 4, eol: "\n" });
  assert.deepEqual(detectFormatting('{\r\n\t"a": 1\r\n}'), { insertSpaces: false, tabSize: 4, eol: "\r\n" });
  assert.deepEqual(detectFormatting('{"a":1}'), { insertSpaces: true, tabSize: 2, eol: "\n" });
});

test("editing one value leaves comments, formatting and other values untouched", () => {
  const text =
    '{\n' +
    '    // port to bind\n' +
    '    "port": 8080,\n' +
    '    "id": 12345678901234567890,\n' +
    '    "nested": { "x": 1, "y": "keep" } /* trailing */\n' +
    '}';
  const out = edit(text, (d) => {
    d.port = 9090;
    d.nested.y = "changed";
  });
  assert.equal(out, text.replace("8080", "9090").replace('"keep"', '"changed"'));
});

test("trailing newline and tab indentation survive", () => {
  const text = '{\n\t"a": 1,\n\t"b": 2\n}\n';
  assert.equal(edit(text, (d) => (d.b = 3)), '{\n\t"a": 1,\n\t"b": 3\n}\n');
});

test("array length change rewrites only that array", () => {
  const text = '{\n  "list": [1, 2],\n  "other": true\n}';
  const out = edit(text, (d) => d.list.push(3));
  assert.deepEqual(parseDocument(out).data, { list: [1, 2, 3], other: true });
  assert.ok(out.includes('"other": true'));
});

test("added and removed keys", () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}';
  const out = edit(text, (d) => {
    delete d.a;
    d.c = { d: [1] };
  });
  assert.deepEqual(parseDocument(out).data, { b: 2, c: { d: [1] } });
});

test("no change produces identical text", () => {
  const text = '{ "a": [1, {"b": null}] }';
  assert.equal(edit(text, () => {}), text);
});

test("minimalReplacement", () => {
  assert.deepEqual(minimalReplacement("abcXdef", "abcYYdef"), { start: 3, end: 4, text: "YY" });
  assert.deepEqual(minimalReplacement("aaa", "aaaa"), { start: 3, end: 3, text: "a" });
  assert.deepEqual(minimalReplacement("abc", "abc"), { start: 3, end: 3, text: "" });
  for (const [a, b] of [["aXa", "aa"], ["", "x"], ["xyz", ""]]) {
    const r = minimalReplacement(a, b);
    assert.equal(a.slice(0, r.start) + r.text + a.slice(r.end), b);
  }
});

test("deepEqual", () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!deepEqual([1], { 0: 1 }));
});
