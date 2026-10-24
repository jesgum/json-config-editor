(function () {
  const vscode = acquireVsCodeApi();
  const { isPlainObject } = window.ConfigEditorUtil;

  const mainEl = document.getElementById("main");
  const toastEl = document.getElementById("toast");
  const rootEl = document.createElement("div");
  rootEl.id = "root";

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  const tree = window.ConfigTree.create({
    sides: 1,
    onEdit: (_side, data) => vscode.postMessage({ type: "edit", data }),
    toast,
    scroller: mainEl,
    search: {
      input: document.getElementById("search"),
      count: document.getElementById("searchCount"),
    },
  });

  function showMessage(html) {
    mainEl.innerHTML = '<div class="loadbox">' + html + "</div>";
  }

  function renderRoot() {
    const data = tree.getData(0);
    if (!isPlainObject(data)) {
      return showMessage(
        "<h2>Not a JSON object</h2><p>This editor requires a JSON object <code>{…}</code> at the root.</p>"
      );
    }
    if (Object.keys(data).length === 0) {
      return showMessage("<h2>Empty object</h2><p>The file contains <code>{}</code>.</p>");
    }
    if (rootEl.parentNode !== mainEl) {
      mainEl.innerHTML = "";
      mainEl.appendChild(rootEl);
    }
    tree.render(rootEl);
  }

  /* ════════════════  toolbar  ════════════════ */

  document.getElementById("expandAll").addEventListener("click", () => tree.expandAll());
  document.getElementById("collapseAll").addEventListener("click", () => tree.collapseAll());

  /* ════════════════  VS Code messaging  ════════════════ */

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type !== "update") return;

    if (msg.empty) {
      tree.setData(0, null);
      return showMessage("<h2>Empty file</h2><p>Add JSON content to this file, then reopen the editor.</p>");
    }
    if (msg.error) {
      tree.setData(0, null);
      return showMessage(
        '<h2>⚠ Invalid JSON</h2><p style="color:var(--vscode-errorForeground)">' + esc(msg.error) + "</p>"
      );
    }
    if (tree.setData(0, msg.data)) renderRoot();
  });

  vscode.postMessage({ type: "ready" });
})();
