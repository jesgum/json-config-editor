import * as vscode from "vscode";

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
        vscode.window.showWarningMessage("JSON Config Editor only works with .json files.");
        return;
      }
      await openCustomEditor(target, vscode.window.activeTextEditor?.viewColumn);
    })
  );
}

function isJsonFile(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith(".json");
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
    if (typeof (vscode.window.tabGroups as any).close === "function") {
      await (vscode.window.tabGroups as any).close(tabsToClose, true);
      return;
    }
  }

  const editors = vscode.window.visibleTextEditors.filter((editor) => editor.document.uri.toString() === normalized);
  if (editors.length === 0) {
    return;
  }

  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === normalized) {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    return;
  }

  const sameUriEditor = editors[0];
  await vscode.window.showTextDocument(sameUriEditor.document, sameUriEditor.viewColumn, true);
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
}

function getUriFromTab(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input as any;
  if (input?.uri instanceof vscode.Uri) {
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

    let skipNext = 0;

    const sendDoc = () =>
      panel.webview.postMessage({
        type: "update",
        text: document.getText(),
      });

    const onMsg = panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        sendDoc();
        return;
      }
      if (msg.type === "edit") {
        skipNext++;
        const full = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        const we = new vscode.WorkspaceEdit();
        we.replace(document.uri, full, msg.text);
        await vscode.workspace.applyEdit(we);
      }
    });

    const onDoc = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) { return; }
      if (skipNext > 0) {
        skipNext--;
        return;
      }
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
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "main.js")
    );
    const nonce = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
        (Math.random() * 62) | 0
      ]
    ).join("");

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
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export function deactivate() {}