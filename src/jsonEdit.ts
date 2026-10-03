import {
  applyEdits,
  FormattingOptions,
  JSONPath,
  modify,
  parse,
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

  const walk = (path: JSONPath, a: unknown, b: unknown) => {
    if (deepEqual(a, b)) {
      return;
    }
    if (isObject(a) && isObject(b)) {
      for (const k of Object.keys(a)) {
        if (!hasOwn(b, k)) {
          set(path.concat(k), undefined);
        }
      }
      for (const k of Object.keys(b)) {
        if (hasOwn(a, k)) {
          walk(path.concat(k), a[k], b[k]);
        } else {
          set(path.concat(k), b[k]);
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
