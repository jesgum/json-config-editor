import * as vscode from "vscode";

let toggleActive = false;
let redirectDisposable: vscode.Disposable | undefined;
let lastRedirectedUri: string | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  const provider = new ConfigEditorProvider(ctx);

  // Restore toggle state from previous session
  toggleActive = ctx.globalState.get<boolean>("jsonConfigEditor.active", false);
  vscode.commands.executeCommand("setContext", "jsonConfigEditor.isActive", toggleActive);

  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "jsonConfigEditor.visual",
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Keep a non-contributed fallback command for compatibility
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
      await redirectToCustomEditorFromUri(target);
    })
  );

  // Toggle ON
  ctx.subscriptions.push(
    vscode.commands.registerCommand("jsonConfigEditor.toggleOn", async () => {
      toggleActive = true;
      ctx.globalState.update("jsonConfigEditor.active", true);
      await vscode.commands.executeCommand("setContext", "jsonConfigEditor.isActive", true);
      startRedirect(ctx);

      // Redirect current editor immediately if it's a JSON text editor
      const editor = vscode.window.activeTextEditor;
      if (editor && isJsonFile(editor.document.uri)) {
        await redirectToCustomEditor(editor);
      }
    })
  );

  // Toggle OFF
  ctx.subscriptions.push(
    vscode.commands.registerCommand("jsonConfigEditor.toggleOff", async () => {
      toggleActive = false;
      ctx.globalState.update("jsonConfigEditor.active", false);
      await vscode.commands.executeCommand("setContext", "jsonConfigEditor.isActive", false);
      stopRedirect();
    })
  );

  // If toggle was ON from previous session, start listening
  if (toggleActive) {
    startRedirect(ctx);
  }
}

function isJsonFile(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith(".json");
}

async function redirectToCustomEditor(editor: vscode.TextEditor) {
  await redirectToCustomEditorFromUri(editor.document.uri, editor.viewColumn);
}

async function redirectToCustomEditorFromUri(uri: vscode.Uri, viewColumn?: vscode.ViewColumn) {
  const key = uri.toString();
  if (lastRedirectedUri === key) {
    return;
  }
  lastRedirectedUri = key;
  await vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    "jsonConfigEditor.visual",
    viewColumn ?? vscode.ViewColumn.Active
  );
}

function startRedirect(ctx: vscode.ExtensionContext) {
  if (redirectDisposable) { return; }
  redirectDisposable = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (!toggleActive || !isJsonFile(document.uri)) { return; }
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === document.uri.toString());
    if (editor) {
      await redirectToCustomEditor(editor);
    }
  });
  ctx.subscriptions.push(redirectDisposable);
}

function stopRedirect() {
  if (redirectDisposable) {
    redirectDisposable.dispose();
    redirectDisposable = undefined;
  }
  lastRedirectedUri = undefined;
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