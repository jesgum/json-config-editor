import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { applyDataChange, detectFormatting, minimalReplacement, parseDocument } from "./jsonEdit";

let isRedirecting = false;

export function activate(ctx: vscode.ExtensionContext) {
  const provider = new ConfigEditorProvider(ctx);

  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "jsonConfigEditor.visual",
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("jsonConfigEditor.open", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage("Open a JSON file first.");
        return;
      }
      if (!isJsonFile(target)) {
        vscode.window.showWarningMessage("JSON Config Editor only works with .json and .jsonc files.");
        return;
      }
      await openCustomEditor(target, vscode.window.activeTextEditor?.viewColumn);
    })
  );
}

function isJsonFile(uri: vscode.Uri): boolean {
  return /\.jsonc?$/i.test(uri.path);
}

async function openCustomEditor(uri: vscode.Uri, viewColumn?: vscode.ViewColumn) {
  if (isRedirecting) {
    return;
  }
  isRedirecting = true;
  try {
    await closeEditorsForUri(uri);
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      "jsonConfigEditor.visual",
      viewColumn ?? vscode.ViewColumn.Active
    );
  } finally {
    isRedirecting = false;
  }
}

async function closeEditorsForUri(uri: vscode.Uri) {
  const normalized = uri.toString();

  const tabsToClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const tabUri = getUriFromTab(tab);
      if (tabUri?.toString() === normalized) {
        tabsToClose.push(tab);
      }
    }
  }

  if (tabsToClose.length > 0) {
    await vscode.window.tabGroups.close(tabsToClose, true);
  }
}

function getUriFromTab(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

/* ───────── CustomTextEditorProvider ───────── */
class ConfigEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
      ],
    };
    panel.webview.html = this.html(panel.webview);

    // text of the last edit the webview sent, so its echo isn't sent back
    let lastWebviewText: string | undefined;

    const sendDoc = () =>
      panel.webview.postMessage({
        type: "update",
        ...parseDocument(document.getText()),
      });

    const onMsg = panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        sendDoc();
        return;
      }
      if (msg.type === "edit") {
        const text = document.getText();
        const current = parseDocument(text);
        if (!("data" in current)) { return; }
        const newText = applyDataChange(text, current.data, msg.data, detectFormatting(text));
        if (newText === text) { return; }
        lastWebviewText = newText;
        // replace only the changed span so VS Code undo and cursors behave
        const r = minimalReplacement(text, newText);
        const we = new vscode.WorkspaceEdit();
        we.replace(
          document.uri,
          new vscode.Range(document.positionAt(r.start), document.positionAt(r.end)),
          r.text
        );
        await vscode.workspace.applyEdit(we);
      }
    });

    const onDoc = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) { return; }
      if (e.contentChanges.length === 0) { return; }
      const isEcho = e.document.getText() === lastWebviewText;
      lastWebviewText = undefined;
      if (isEcho) { return; }
      sendDoc();
    });

    panel.onDidDispose(() => {
      onMsg.dispose();
      onDoc.dispose();
    });

    sendDoc();
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "style.css")
    );
    const util = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "util.js")
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "main.js")
    );
    const nonce = randomBytes(16).toString("hex");

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
            style-src ${webview.cspSource} 'unsafe-inline';
            script-src 'nonce-${nonce}';">
  <link href="${css}" rel="stylesheet">
  <title>Config Editor</title>
</head>
<body>
  <header>
    <div class="brand">
      <div class="t">JSON Config Editor</div>
      <div class="s">tree view for nested JSON</div>
    </div>
    <input id="search" type="search" placeholder="filter top-level keys…"/>
    <button id="expandAll"   class="ghost">expand all</button>
    <button id="collapseAll" class="ghost">collapse all</button>
    <div class="spacer"></div>
  </header>
  <main id="main"></main>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${util}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export function deactivate() {}