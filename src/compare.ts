import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { parseDocument } from "./jsonEdit";
import { dataEdit } from "./documentEdit";

/* ───────── Editable tree compare of two JSON files ───────── */
export function openComparePanel(
  ctx: vscode.ExtensionContext,
  left: vscode.Uri,
  right: vscode.Uri,
  openFile: (uri: vscode.Uri) => Thenable<void>
) {
  const panel = vscode.window.createWebviewPanel(
    "jsonConfigEditor.compare",
    `${baseName(left)} ↔ ${baseName(right)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
    }
  );
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
  panel.webview.html = html(ctx, panel.webview);

  let sides = { left, right };

  const read = async (uri: vscode.Uri) => {
    try {
      return parseDocument((await vscode.workspace.openTextDocument(uri)).getText());
    } catch (e) {
      return { error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  const sendDiff = async (swapped = false) => {
    const [l, r] = await Promise.all([read(sides.left), read(sides.right)]);
    panel.title = `${baseName(sides.left)} ↔ ${baseName(sides.right)}`;
    panel.webview.postMessage({
      type: "update",
      names: { left: label(sides.left, sides.right), right: label(sides.right, sides.left) },
      left: l,
      right: r,
      swapped,
    });
  };

  // text each file got from our last edit, so its change event isn't sent back as a new diff
  const ownText = new Map<string, string>();

  /** Write an edit from the webview; saved right away unless the file already had unsaved changes */
  const writeSide = async (uri: vscode.Uri, data: unknown) => {
    const document = await vscode.workspace.openTextDocument(uri);
    const wasDirty = document.isDirty;
    const change = dataEdit(document, data);
    if (!change) { return; }
    ownText.set(uri.toString(), change.text);
    if (!(await vscode.workspace.applyEdit(change.edit))) {
      ownText.delete(uri.toString());
      vscode.window.showErrorMessage(`Could not edit ${baseName(uri)}.`);
      return;
    }
    if (!wasDirty) { await document.save(); }
  };

  // typing in either file re-sends the diff; debounce so large files stay responsive
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleDiff = () => {
    clearTimeout(timer);
    timer = setTimeout(sendDiff, 250);
  };

  const onMsg = panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "ready") {
      await sendDiff();
    } else if (msg.type === "swap") {
      sides = { left: sides.right, right: sides.left };
      await sendDiff(true);
    } else if (msg.type === "edit" && (msg.side === 0 || msg.side === 1)) {
      await writeSide(msg.side === 0 ? sides.left : sides.right, msg.data);
    } else if (msg.type === "open" && (msg.side === "left" || msg.side === "right")) {
      await openFile(sides[msg.side as "left" | "right"]);
    }
  });

  const isSide = (uri: vscode.Uri) =>
    uri.toString() === sides.left.toString() || uri.toString() === sides.right.toString();

  const onDoc = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.contentChanges.length === 0 || !isSide(e.document.uri)) { return; }
    const key = e.document.uri.toString();
    const isEcho = ownText.get(key) === e.document.getText();
    ownText.delete(key);
    if (!isEcho) { scheduleDiff(); }
  });

  panel.onDidDispose(() => {
    clearTimeout(timer);
    onMsg.dispose();
    onDoc.dispose();
  });
}

function baseName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? uri.path;
}

/** File name, or the workspace-relative path when both files share a name */
function label(uri: vscode.Uri, other: vscode.Uri): string {
  return baseName(uri) === baseName(other)
    ? vscode.workspace.asRelativePath(uri)
    : baseName(uri);
}

function html(ctx: vscode.ExtensionContext, webview: vscode.Webview): string {
  const media = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", file));
  const nonce = randomBytes(16).toString("hex");

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
            style-src ${webview.cspSource} 'unsafe-inline';
            script-src 'nonce-${nonce}';">
  <link href="${media("style.css")}" rel="stylesheet">
  <title>Config Compare</title>
</head>
<body>
  <header>
    <div class="brand">
      <div class="t">JSON Config Compare</div>
      <div class="s">edit two JSON files in one tree</div>
    </div>
    <input id="search" type="search" placeholder="search keys &amp; values (Ctrl+F)"
      title="Enter / Shift+Enter: next / previous match · Esc: clear · use a.b to match a path"/>
    <span id="searchCount" class="search-count"></span>
    <label class="cmp-toggle"><input type="checkbox" id="onlyDiff"/>differences only</label>
    <button id="swap"        class="ghost" title="Swap left and right">swap</button>
    <button id="expandAll"   class="ghost">expand all</button>
    <button id="collapseAll" class="ghost">collapse all</button>
    <span id="summary"></span>
    <div class="spacer"></div>
  </header>
  <main id="main" class="compare"></main>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${media("util.js")}"></script>
  <script nonce="${nonce}" src="${media("tree.js")}"></script>
  <script nonce="${nonce}" src="${media("compare.js")}"></script>
</body>
</html>`;
}
