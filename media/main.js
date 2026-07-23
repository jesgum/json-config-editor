(function () {
  const vscode = acquireVsCodeApi();

  let DATA = null;
  let editTimer = null;
  let pendingEdit = false;
  const mainEl = document.getElementById("main");
  const toastEl = document.getElementById("toast");

  /* ════════════════  undo / redo  ════════════════ */

  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 50;

  function snapshot() {
    return JSON.stringify(DATA);
  }

  function pushUndo() {
    const current = Array.from(expandedPaths);
    undoStack.push({ text: snapshot(), expanded: current });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // clear redo on new edit
  }

  function undo() {
    if (!undoStack.length || DATA === null) return;
    const current = Array.from(expandedPaths);
    redoStack.push({ text: snapshot(), expanded: current });
    const state = undoStack.pop();
    if (!state || !state.text) return;
    DATA = JSON.parse(state.text);
    expandedPaths.clear();
    if (state.expanded && Array.isArray(state.expanded)) {
      state.expanded.forEach((p) => expandedPaths.add(p));
    }
    renderRoot(false);
    postEdit();
    toast("Undo");
  }

  function redo() {
    if (!redoStack.length || DATA === null) return;
    const current = Array.from(expandedPaths);
    undoStack.push({ text: snapshot(), expanded: current });
    const state = redoStack.pop();
    if (!state || !state.text) return;
    DATA = JSON.parse(state.text);
    expandedPaths.clear();
    if (state.expanded && Array.isArray(state.expanded)) {
      state.expanded.forEach((p) => expandedPaths.add(p));
    }
    renderRoot(false);
    postEdit();
    toast("Redo");
  }

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });

  /* ════════════════  helpers  ════════════════ */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function postEdit() {
    if (DATA === null) return;
    pendingEdit = true;
    vscode.postMessage({ type: "edit", text: JSON.stringify(DATA, null, 2) });
  }

  function notifyEdit() {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      postEdit();
    }, 500);
  }

  /** Call before any mutation to DATA */
  function beforeEdit() {
    pushUndo();
  }

  function getAtPath(obj, path) {
    return path.reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setAtPath(obj, path, val) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = val;
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function isMatrixDef(v) {
    return (
      isPlainObject(v) &&
      "labels_rows" in v &&
      "labels_cols" in v &&
      "values" in v &&
      Array.isArray(v.values)
    );
  }
  function isPrimitiveArray(arr) {
    return arr.every(
      (x) => typeof x === "string" || typeof x === "number" || x === null
    );
  }
  function countChildren(v) {
    if (Array.isArray(v)) return v.length;
    if (isPlainObject(v)) return Object.keys(v).length;
    return 0;
  }

  /* ════════════════  open/closed state  ════════════════ */

  const expandedPaths = new Set();

  function collectOpenPaths() {
    expandedPaths.clear();
    const root = document.getElementById("root");
    if (!root) return;
    root.querySelectorAll("details[data-path]").forEach((d) => {
      const path = d.getAttribute("data-path");
      if (path && d.open) {
        expandedPaths.add(path);
      }
    });
  }

  function rememberOpenState(wrap) {
    const path = wrap.getAttribute("data-path");
    if (!path) return;
    if (wrap.open) {
      expandedPaths.add(path);
    } else {
      expandedPaths.delete(path);
    }
  }

  function restoreOpenState(root) {
    if (!root || expandedPaths.size === 0) return;

    function onePass() {
      let reopened = 0;
      root.querySelectorAll("details[data-path]").forEach((d) => {
        const path = d.getAttribute("data-path");
        if (!path) return;
        if (expandedPaths.has(path) && !d.open) {
          d.open = true;
          if (d._forceBuild) d._forceBuild();
          reopened++;
        }
      });
      return reopened;
    }

    onePass();
    setTimeout(() => { onePass(); setTimeout(() => onePass(), 20); }, 10);
  }

  /* ════════════════  renderers  ════════════════ */

  function renderLeafRow(container, key, path, depth) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("div");
    label.className = "key depth-" + (depth % 5);
    label.textContent = key;
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(getAtPath(DATA, path) ?? "");
    input.addEventListener("focus", () => {
      input._before = input.value;
    });
    input.addEventListener("input", () => {
      if (input._snapshotted !== input._before) {
        beforeEdit();
        input._snapshotted = input._before;
      }
      setAtPath(DATA, path, input.value);
      notifyEdit();
    });
    row.append(label, input);
    container.appendChild(row);
  }

  function pathId(path) {
    return path.join(".");
  }

  function renderPrimitiveArray(container, key, path, arr, depth) {
    const wrap = document.createElement("details");
    const id = pathId(path);
    wrap.setAttribute("data-path", id);
    wrap.classList.add("depth-" + (depth % 5));
    const summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="arrow">▸</span><span class="key leaf-key">' +
      esc(key) +
      '</span><span class="badge">' +
      arr.length +
      " items</span>";
    wrap.appendChild(summary);
    wrap.classList.add("depth-" + (depth % 5));
    wrap.classList.add("leaf-array");

    const body = document.createElement("div");
    body.className = "arrwrap";
    let built = false;

    function buildArrayBody() {
      if (built) return;
      built = true;
      const ta = document.createElement("textarea");
      ta.className = "arr";
      ta.value = getAtPath(DATA, path).join(", ");
      ta.addEventListener("change", () => {
        beforeEdit();
        const a = ta.value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length);
        setAtPath(DATA, path, a);
        summary.querySelector(".badge").textContent = a.length + " items";
        notifyEdit();
      });
      const hint = document.createElement("div");
      hint.className = "arrhint";
      hint.textContent = "comma-separated — edit and click away to save";
      body.append(ta, hint);
      wrap.appendChild(body);
    }

    const expanded = expandedPaths.has(id);
    if (expanded) {
      wrap.open = true;
      buildArrayBody();
    }

    wrap.addEventListener("toggle", () => {
      rememberOpenState(wrap);
      if (wrap.open) {
        buildArrayBody();
      }
    });
    wrap._forceBuild = buildArrayBody;
    container.appendChild(wrap);
  }

  function renderMatrix(container, key, path, def, depth) {
    const wrap = document.createElement("details");
    wrap.setAttribute("data-path", pathId(path));
    wrap.classList.add("depth-" + (depth % 5));
    wrap.open = true;
    const rows = def.labels_rows,
      cols = def.labels_cols;

    const summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="arrow">▸</span><span class="key">' +
      esc(key) +
      '</span><span class="badge">' +
      rows.length +
      "×" +
      cols.length +
      "</span>";
    wrap.appendChild(summary);

    const body = document.createElement("div");
    const table = document.createElement("table");
    table.className = "matrix";

    const thead = document.createElement("tr");
    thead.innerHTML =
      "<th></th>" + cols.map((c) => "<th>" + esc(c) + "</th>").join("");
    table.appendChild(thead);

    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.className = "rowlabel";
      td0.textContent = r;
      tr.appendChild(td0);

      cols.forEach((_c, j) => {
        const td = document.createElement("td");
        const val = def.values[i][j];
        if (val === "0" || val === "1") {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = val === "1";
          cb.addEventListener("change", () => {
            beforeEdit();
            getAtPath(DATA, path).values[i][j] = cb.checked ? "1" : "0";
            notifyEdit();
          });
          td.appendChild(cb);
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = val;
          inp.addEventListener("focus", () => {
            inp._before = inp.value;
          });
          inp.addEventListener("input", () => {
            if (inp._snapshotted !== inp._before) {
              beforeEdit();
              inp._snapshotted = inp._before;
            }
            getAtPath(DATA, path).values[i][j] = inp.value;
            notifyEdit();
          });
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    body.appendChild(table);
    wrap.appendChild(body);
    wrap.addEventListener("toggle", () => rememberOpenState(wrap));
    container.appendChild(wrap);
  }

  function renderObject(container, key, path, obj, depth) {
    const id = pathId(path);
    const wrap = document.createElement("details");
    wrap.setAttribute("data-path", id);
    wrap.classList.add("depth-" + (depth % 5));
    const n = countChildren(obj);

    const summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="arrow">▸</span><span class="key">' +
      esc(key) +
      '</span><span class="badge">' +
      n +
      " field" +
      (n === 1 ? "" : "s") +
      "</span>";
    wrap.appendChild(summary);

    const childrenEl = document.createElement("div");
    childrenEl.className = "children";
    let built = false;

    function build() {
      if (built) return;
      built = true;
      Object.keys(obj).forEach((k) =>
        renderEntry(childrenEl, k, path.concat(k), obj[k], depth + 1)
      );
      wrap.appendChild(childrenEl);
    }

    const expanded = expandedPaths.has(id);
    if (expanded) {
      wrap.open = true;
      build();
    }

    wrap.addEventListener("toggle", () => {
      rememberOpenState(wrap);
      if (wrap.open) build();
    });
    wrap._forceBuild = build;
    container.appendChild(wrap);
  }

  function renderEntry(container, key, path, value, depth) {
    if (typeof value === "string" || typeof value === "number") {
      renderLeafRow(container, key, path, depth);
    } else if (Array.isArray(value)) {
      if (value.length === 0 || isPrimitiveArray(value)) {
        renderPrimitiveArray(container, key, path, value, depth);
      } else {
        const wrap = document.createElement("details");
        wrap.setAttribute("data-path", pathId(path));
        wrap.classList.add("depth-" + (depth % 5));
        const summary = document.createElement("summary");
        summary.innerHTML =
          '<span class="arrow">▸</span><span class="key">' +
          esc(key) +
          '</span><span class="badge">' +
          value.length +
          " items</span>";
        wrap.appendChild(summary);
        const childrenEl = document.createElement("div");
        childrenEl.className = "children";
        let built = false;
        wrap.addEventListener("toggle", () => {
          rememberOpenState(wrap);
          if (wrap.open && !built) {
            buildChildren();
          }
        });
        wrap._forceBuild = () => {
          if (built) return;
          buildChildren();
        };
        function buildChildren() {
          built = true;
          value.forEach((v, i) =>
            renderEntry(childrenEl, "[" + i + "]", path.concat(i), v, depth + 1)
          );
          wrap.appendChild(childrenEl);
        }
        const expanded = expandedPaths.has(pathId(path));
        if (expanded) {
          wrap.open = true;
          buildChildren();
        }
        container.appendChild(wrap);
      }
    } else if (isMatrixDef(value)) {
      renderMatrix(container, key, path, value, depth);
    } else if (isPlainObject(value)) {
      renderObject(container, key, path, value, depth);
    } else {
      renderLeafRow(container, key, path, depth);
    }
  }

  function renderRoot(preserveState) {
    let openPaths = null;
    if (preserveState) {
      openPaths = collectOpenPaths();
    }

    const fragment = document.createDocumentFragment();
    if (DATA === null) {
      fragment.appendChild(document.createElement("div")).className = "loadbox";
      const empty = document.createElement("div");
      empty.className = "loadbox";
      empty.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">Waiting for data…</p>';
      fragment.innerHTML = empty.outerHTML;
      mainEl.innerHTML = "";
      mainEl.appendChild(fragment);
      return;
    }
    if (typeof DATA !== "object" || Array.isArray(DATA)) {
      mainEl.innerHTML =
        '<div class="loadbox"><h2>Not a JSON object</h2>' +
        "<p>This editor requires a JSON object <code>{…}</code> at the root.</p></div>";
      return;
    }
    const keys = Object.keys(DATA);
    if (keys.length === 0) {
      mainEl.innerHTML =
        '<div class="loadbox"><h2>Empty object</h2><p>The file contains <code>{}</code>.</p></div>';
      return;
    }
    const root = document.createElement("div");
    root.id = "root";
    keys.forEach((k) => renderEntry(root, k, [k], DATA[k], 0));
    restoreOpenState(root);
    mainEl.innerHTML = "";
    mainEl.appendChild(root);
  }

  /* ════════════════  toolbar  ════════════════ */

  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const root = document.getElementById("root");
    if (!root) return;
    Array.from(root.children).forEach((node) => {
      const el = node.querySelector("summary .key, .key");
      const text = (el ? el.textContent : "").toLowerCase();
      node.style.display = text.includes(q) ? "" : "none";
    });
  });

  document.getElementById("expandAll").addEventListener("click", () => {
    const root = document.getElementById("root");
    if (!root) return;
    function openAll(el) {
      el.querySelectorAll("details").forEach((d) => {
        if (!d.open) {
          d.open = true;
          if (d._forceBuild) d._forceBuild();
        }
      });
    }
    openAll(root);
    setTimeout(() => openAll(root), 30);
    setTimeout(() => openAll(root), 100);
  });

  document.getElementById("collapseAll").addEventListener("click", () => {
    const root = document.getElementById("root");
    if (!root) return;
    root.querySelectorAll("details").forEach((d) => (d.open = false));
  });

  /* ════════════════  VS Code messaging  ════════════════ */

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type !== "update") return;

    if (pendingEdit) {
      pendingEdit = false;
      return;
    }

    const text = msg.text;
    if (!text || !text.trim()) {
      DATA = null;
      mainEl.innerHTML =
        '<div class="loadbox"><h2>Empty file</h2>' +
        "<p>Add JSON content to this file, then reopen the editor.</p></div>";
      return;
    }
    try {
      const nextData = JSON.parse(text);
      const currentText = DATA === null ? null : JSON.stringify(DATA);
      const nextText = JSON.stringify(nextData);
      if (currentText !== null && currentText === nextText) {
        return;
      }

      DATA = nextData;
      renderRoot(true);
    } catch (e) {
      DATA = null;
      mainEl.innerHTML =
        '<div class="loadbox"><h2>⚠ Invalid JSON</h2>' +
        '<p style="color:var(--vscode-errorForeground)">' +
        esc(e.message) +
        "</p></div>";
    }
  });

  vscode.postMessage({ type: "ready" });
})();