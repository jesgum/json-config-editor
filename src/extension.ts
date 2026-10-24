import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { parseDocument } from "./jsonEdit";
import { dataEdit } from "./documentEdit";
import { openComparePanel } from "./compare";

let isRedirecting = false;
let selectedForCompare: vscode.Uri | undefined;

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

  const compare = (left: vscode.Uri, right: vscode.Uri) =>
    openComparePanel(ctx, left, right, (uri) => openCustomEditor(uri, vscode.ViewColumn.Beside));

  ctx.subscriptions.push(
    vscode.commands.registerCommand("jsonConfigEditor.selectForCompare", async (uri?: vscode.Uri) => {
      const target = jsonTarget(uri);
      if (!target) { return; }
      selectedForCompare = target;
      await vscode.commands.executeCommand("setContext", "jsonConfigEditor.selectedForCompare", true);
    }),

    vscode.commands.registerCommand("jsonConfigEditor.compareWithSelected", (uri?: vscode.Uri) => {
      const target = jsonTarget(uri);
      if (!target) { return; }
      if (!selectedForCompare) {
        vscode.window.showWarningMessage("Select a JSON file for compare first.");
        return;
      }
      if (selectedForCompare.toString() === target.toString()) {
        vscode.window.showWarningMessage("Pick a different file than the one selected for compare.");
        return;
      }
      compare(selectedForCompare, target);
    }),

    // explorer multi-select: (clicked item, all selected items)
    vscode.commands.registerCommand("jsonConfigEditor.compareSelected", (_uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      if (uris?.length !== 2 || !uris.every(isJsonFile)) {
        vscode.window.showWarningMessage("Select exactly two .json or .jsonc files to compare.");
        return;
      }
      compare(uris[0], uris[1]);
    })
  );
}

/** The file a command was run on (explorer or tab context menu), else the active editor's file */
function jsonTarget(uri?: vscode.Uri): vscode.Uri | undefined {
  const target = uri ?? activeTabUri();
  if (!target) {
    vscode.window.showWarningMessage("Open a JSON file first.");
    return undefined;
  }
  if (!isJsonFile(target)) {
    vscode.window.showWarningMessage("JSON Config Editor only works with .json and .jsonc files.");
    return undefined;
  }
  return target;
}

function activeTabUri(): vscode.Uri | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return (tab && getUriFromTab(tab)) ?? vscode.window.activeTextEditor?.document.uri;
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
        const change = dataEdit(document, msg.data);
        if (!change) { return; }
        lastWebviewText = change.text;
        await vscode.workspace.applyEdit(change.edit);
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
    const tree = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "tree.js")
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
    <input id="search" type="search" placeholder="search keys &amp; values (Ctrl+F)"
      title="Enter / Shift+Enter: next / previous match · Esc: clear · use a.b to match a path"/>
    <span id="searchCount" class="search-count"></span>
    <button id="expandAll"   class="ghost">expand all</button>
    <button id="collapseAll" class="ghost">collapse all</button>
    <div class="spacer"></div>
  </header>
  <main id="main"></main>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${util}"></script>
  <script nonce="${nonce}" src="${tree}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export function deactivate() {}