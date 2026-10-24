(function () {
  const vscode = acquireVsCodeApi();
  const { isPlainObject } = window.ConfigEditorUtil;

  const mainEl = document.getElementById("main");
  const summaryEl = document.getElementById("summary");
  const toastEl = document.getElementById("toast");
  const onlyDiffEl = document.getElementById("onlyDiff");

  const headEl = document.createElement("div");
  const treeEl = document.createElement("div");
  const emptyEl = document.createElement("p");
  emptyEl.className = "cmp-empty";
  emptyEl.textContent = "No differences.";

  let NAMES = { left: "", right: "" };
  let loaded = false;

  const state = vscode.getState();
  if (state && typeof state.onlyDiff === "boolean") onlyDiffEl.checked = state.onlyDiff;

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

  /** Count changed values and added/removed fields; an added subtree counts once */
  function countStatuses(node, counts) {
    if (node.status === "added" || node.status === "removed") {
      counts[node.status]++;
    } else if (node.children) {
      node.children.forEach((c) => countStatuses(c.node, counts));
    } else if (node.status === "changed") {
      counts.changed++;
    }
    return counts;
  }

  function renderSummary(diff) {
    const c = countStatuses(diff, { changed: 0, added: 0, removed: 0 });
    if (!c.changed && !c.added && !c.removed) {
      summaryEl.textContent = "identical";
      return;
    }
    summaryEl.innerHTML =
      '<span class="status-changed">' + c.changed + " changed</span> · " +
      '<span class="status-added">' + c.added + " added</span> · " +
      '<span class="status-removed">' + c.removed + " removed</span>";
  }

  const tree = window.ConfigTree.create({
    sides: 2,
    onEdit: (side, data) => vscode.postMessage({ type: "edit", side, data }),
    toast,
    scroller: mainEl,
    onStatus: renderSummary,
    search: {
      input: document.getElementById("search"),
      count: document.getElementById("searchCount"),
    },
  });

  function fileLink(side) {
    return '<a href="#" data-side="' + side + '" title="Open in the editor">' + esc(NAMES[side]) + "</a>";
  }

  function renderHead() {
    headEl.className = "cmp-head";
    headEl.innerHTML = "<div></div><div>" + fileLink("left") + "</div><div>" + fileLink("right") + "</div>";
  }

  function renderAll() {
    const left = tree.getData(0);
    const right = tree.getData(1);
    const bothObjects = isPlainObject(left) && isPlainObject(right);
    const bothArrays = Array.isArray(left) && Array.isArray(right);
    if (!bothObjects && !bothArrays) {
      summaryEl.textContent = "";
      mainEl.innerHTML =
        '<div class="loadbox"><h2>Can\'t compare these files</h2>' +
        "<p>Both files need a JSON object <code>{…}</code> (or both a list <code>[…]</code>) at the root.</p></div>";
      return;
    }
    if (headEl.parentNode !== mainEl) {
      mainEl.innerHTML = "";
      mainEl.append(headEl, treeEl);
    }
    renderHead();
    tree.setOnlyDiff(onlyDiffEl.checked);
    tree.render(treeEl);
    if (onlyDiffEl.checked && tree.diff().status === "same") treeEl.appendChild(emptyEl);
  }

  function showProblem(html) {
    summaryEl.textContent = "";
    mainEl.innerHTML = '<div class="loadbox">' + html + "</div>";
  }

  /* ════════════════  toolbar  ════════════════ */

  onlyDiffEl.addEventListener("change", () => {
    vscode.setState({ onlyDiff: onlyDiffEl.checked });
    if (loaded) renderAll();
  });

  document.getElementById("swap").addEventListener("click", () => {
    tree.flushEdits();
    vscode.postMessage({ type: "swap" });
  });

  document.getElementById("expandAll").addEventListener("click", () => tree.expandAll());
  document.getElementById("collapseAll").addEventListener("click", () => tree.collapseAll());

  mainEl.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-side]");
    if (!link) return;
    e.preventDefault();
    vscode.postMessage({ type: "open", side: link.getAttribute("data-side") });
  });

  /* ════════════════  VS Code messaging  ════════════════ */

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type !== "update") return;
    NAMES = msg.names;
    for (const side of ["left", "right"]) {
      const doc = msg[side];
      if (doc.error) {
        loaded = false;
        tree.setData(0, null);
        tree.setData(1, null);
        return showProblem(
          "<h2>⚠ Invalid JSON in " + esc(NAMES[side]) + "</h2>" +
          '<p style="color:var(--vscode-errorForeground)">' + esc(doc.error) + "</p>"
        );
      }
    }
    // an empty file compares like an empty object
    const changedLeft = tree.setData(0, msg.left.empty ? {} : msg.left.data);
    const changedRight = tree.setData(1, msg.right.empty ? {} : msg.right.data);
    if (changedLeft || changedRight || !loaded || msg.swapped) {
      loaded = true;
      renderAll();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
