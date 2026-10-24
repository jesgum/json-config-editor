import {
  applyEdits,
  findNodeAtLocation,
  FormattingOptions,
  JSONPath,
  modify,
  parse,
  parseTree,
  ParseError,
  printParseErrorCode,
} from "jsonc-parser";

/* Pure document logic, kept free of the vscode API so it can be unit-tested. */

export type ParseResult =
  | { empty: true }
  | { error: string }
  | { data: unknown };

/** Parse JSON, tolerating comments and trailing commas (JSONC). */
export function parseDocument(text: string): ParseResult {
  if (!text.trim()) {
    return { empty: true };
  }
  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const { error, offset } = errors[0];
    const { line, column } = lineAndColumn(text, offset);
    return { error: `${printParseErrorCode(error)} at line ${line}, column ${column}` };
  }
  return { data };
}

function lineAndColumn(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return { line, column };
}

/** Infer indentation and line endings from the existing text. */
export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)\S/.exec(text)?.[1];
  if (indent?.startsWith("\t")) {
    return { insertSpaces: false, tabSize: 4, eol };
  }
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol };
}

/**
 * Rewrite `text` so it represents `newData`, touching only the values that differ from
 * `oldData` (the parsed form of `text`). Comments, formatting and untouched values,
 * including numbers too large for a JS double, are left exactly as they were.
 * New keys are placed after the key that precedes them in `newData`, and a key replaced
 * by a new name holding the same value at the same position is renamed in place.
 */
export function applyDataChange(
  text: string,
  oldData: unknown,
  newData: unknown,
  formattingOptions: FormattingOptions
): string {
  const set = (path: JSONPath, value: unknown) => {
    text = applyEdits(text, modify(text, path, value, { formattingOptions }));
  };

  const insert = (path: JSONPath, key: string, value: unknown, order: string[]) => {
    const before = order.slice(0, order.indexOf(key));
    const getInsertionIndex = (properties: string[]) => {
      for (let i = before.length - 1; i >= 0; i--) {
        const at = properties.indexOf(before[i]);
        if (at >= 0) {
          return at + 1;
        }
      }
      return 0;
    };
    text = applyEdits(text, modify(text, path.concat(key), value, { formattingOptions, getInsertionIndex }));
  };

  // rewrite only the key, so comments and formatting inside its value survive
  const rename = (path: JSONPath, from: string, to: string, value: unknown, order: string[]) => {
    const tree = parseTree(text, [], { allowTrailingComma: true });
    const keyNode = tree && findNodeAtLocation(tree, path.concat(from))?.parent?.children?.[0];
    if (!keyNode) {
      set(path.concat(from), undefined);
      insert(path, to, value, order);
      return;
    }
    text = text.slice(0, keyNode.offset) + JSON.stringify(to) + text.slice(keyNode.offset + keyNode.length);
  };

  const walk = (path: JSONPath, a: unknown, b: unknown) => {
    if (deepEqual(a, b)) {
      return;
    }
    if (isObject(a) && isObject(b)) {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      const renamedFrom = new Set<string>();
      const renamedTo = new Set<string>();
      aKeys.forEach((k, i) => {
        const to = bKeys[i];
        if (!hasOwn(b, k) && to !== undefined && !hasOwn(a, to) && deepEqual(a[k], b[to])) {
          rename(path, k, to, b[to], bKeys);
          renamedFrom.add(k);
          renamedTo.add(to);
        }
      });
      for (const k of aKeys) {
        if (!hasOwn(b, k) && !renamedFrom.has(k)) {
          set(path.concat(k), undefined);
        }
      }
      for (const k of bKeys) {
        if (hasOwn(a, k)) {
          walk(path.concat(k), a[k], b[k]);
        } else if (!renamedTo.has(k)) {
          insert(path, k, b[k], bKeys);
        }
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((v, i) => walk(path.concat(i), v, b[i]));
      return;
    }
    set(path, b);
  };

  walk([], oldData, newData);
  return text;
}

/** The smallest single replacement that turns `oldText` into `newText`. */
export function minimalReplacement(oldText: string, newText: string) {
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText[start] === newText[start]) {
    start++;
  }
  let tail = 0;
  while (
    tail < max - start &&
    oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    start,
    end: oldText.length - tail,
    text: newText.slice(start, newText.length - tail),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(o: object, k: string) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}
