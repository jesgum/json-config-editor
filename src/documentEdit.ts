import * as vscode from "vscode";
import { applyDataChange, detectFormatting, minimalReplacement, parseDocument } from "./jsonEdit";

/**
 * The edit that makes `document` hold `data`, changing only the values that differ and
 * replacing only the changed span so VS Code undo and cursors behave. `text` is the
 * document's text after the edit. Undefined when there is nothing to change.
 */
export function dataEdit(
  document: vscode.TextDocument,
  data: unknown
): { edit: vscode.WorkspaceEdit; text: string } | undefined {
  const text = document.getText();
  const current = parseDocument(text);
  if (!("data" in current)) { return undefined; }
  const newText = applyDataChange(text, current.data, data, detectFormatting(text));
  if (newText === text) { return undefined; }
  const r = minimalReplacement(text, newText);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(r.start), document.positionAt(r.end)),
    r.text
  );
  return { edit, text: newText };
}
