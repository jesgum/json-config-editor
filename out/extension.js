"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
/* ───────── activate ───────── */
function activate(ctx) {
    const provider = new ConfigEditorProvider(ctx);
    ctx.subscriptions.push(vscode.window.registerCustomEditorProvider("configEditor.visual", provider, { webviewOptions: { retainContextWhenHidden: true } }));
    ctx.subscriptions.push(vscode.commands.registerCommand("configEditor.open", async (uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            vscode.window.showWarningMessage("Open a JSON file first.");
            return;
        }
        // Close the current editor if it has the same file open
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.toString() === target.toString()) {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
        // Open with the custom editor in the same column
        await vscode.commands.executeCommand("vscode.openWith", target, "configEditor.visual");
    }));
}
/* ───────── CustomTextEditorProvider ───────── */
class ConfigEditorProvider {
    constructor(ctx) {
        this.ctx = ctx;
    }
    async resolveCustomTextEditor(document, panel, _token) {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
            ],
        };
        panel.webview.html = this.html(panel.webview);
        /* guards against echo: webview edit → doc change → webview re‑render */
        let skipNext = 0;
        const sendDoc = () => panel.webview.postMessage({
            type: "update",
            text: document.getText(),
        });
        /* messages FROM the webview */
        const onMsg = panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "ready") {
                sendDoc();
                return;
            }
            if (msg.type === "edit") {
                skipNext++;
                const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
                const we = new vscode.WorkspaceEdit();
                we.replace(document.uri, full, msg.text);
                await vscode.workspace.applyEdit(we);
            }
        });
        /* external edits (another editor, git, etc.) → refresh the webview */
        const onDoc = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() !== document.uri.toString())
                return;
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
        sendDoc(); // initial push
    }
    /* ── build HTML shell ── */
    html(webview) {
        const css = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "style.css"));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "main.js"));
        const nonce = Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[(Math.random() * 62) | 0]).join("");
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
      <div class="t">config editor</div>
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
function deactivate() { }
//# sourceMappingURL=extension.js.map