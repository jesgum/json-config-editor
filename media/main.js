(function () {
  const vscode = acquireVsCodeApi();

  let DATA = null;
  let editTimer = null;
  let pendingEdit = false;   // true while we're waiting for our own edit to echo back
  const mainEl = document.getElementById("main");
  const toastEl = document.getElementById("toast");

  /* ════════════════  helpers  ════════════════ */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function notifyEdit() {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (DATA !== null) {
        pendingEdit = true;
        vscode.postMessage({ type: "edit", text: JSON.stringify(DATA, null, 2) });
      }
    }, 500);
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

  /**
   * Walk the DOM tree and collect the "path" attribute of every
   * open <details> element so we can restore state after re-render.
   */
  function collectOpenPaths() {
    const open = new Set();
    const root = document.getElementById("root");
    if (!root) return open;
    root.querySelectorAll("details[data-path]").forEach((d) => {
      if (d.open) open.add(d.getAttribute("data-path"));
    });
    return open;
  }

  function restoreOpenPaths(openSet) {
    if (!openSet || openSet.size === 0) return;
    const root = document.getElementById("root");
    if (!root) return;

    // We may need multiple passes because opening a node triggers
    // lazy building of children, which creates deeper <details>.
    function onePass() {
      let opened = 0;
      root.querySelectorAll("details[data-path]").forEach((d) => {
        if (!d.open && openSet.has(d.getAttribute("data-path"))) {
          d.open = true;
          if (d._forceBuild) d._forceBuild();
          opened++;
        }
      });
      return opened;
    }
    // A few passes to handle lazily-built deeper nodes
    onePass();
    setTimeout(() => { onePass(); setTimeout(() => onePass(), 30); }, 10);
  }

  /* ════════════════  renderers  ════════════════ */

  function renderLeafRow(container, key, path) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("div");
    label.className = "key";
    label.textContent = key;
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(getAtPath(DATA, path) ?? "");
    input.addEventListener("input", () => {
      setAtPath(DATA, path, input.value);
      notifyEdit();
    });
    row.append(label, input);
    container.appendChild(row);
  }

  function pathId(path) {
    return path.join(".");
  }

  function renderPrimitiveArray(container, key, path, arr) {
    const wrap = document.createElement("details");
    wrap.setAttribute("data-path", pathId(path));
    const summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="arrow">▸</span><span class="key">' +
      esc(key) +
      '</span><span class="badge">' +
      arr.length +
      " items</span>";
    wrap.appendChild(summary);

    const body = document.createElement("div");
    body.className = "arrwrap";
    let built = false;

    wrap.addEventListener("toggle", () => {
      if (wrap.open && !built) {
        built = true;
        const ta = document.createElement("textarea");
        ta.className = "arr";
        ta.value = getAtPath(DATA, path).join(", ");
        ta.addEventListener("change", () => {
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
    });
    container.appendChild(wrap);
  }

  function renderMatrix(container, key, path, def) {
    const wrap = document.createElement("details");
    wrap.setAttribute("data-path", pathId(path));
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
            getAtPath(DATA, path).values[i][j] = cb.checked ? "1" : "0";
            notifyEdit();
          });
          td.appendChild(cb);
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = val;
          inp.addEventListener("input", () => {
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
    container.appendChild(wrap);
  }

  function renderObject(container, key, path, obj, depth) {
    const wrap = document.createElement("details");
    wrap.setAttribute("data-path", pathId(path));
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

    wrap.addEventListener("toggle", () => {
      if (wrap.open) build();
    });
    wrap._forceBuild = build;
    container.appendChild(wrap);
  }

  function renderEntry(container, key, path, value, depth) {
    if (typeof value === "string" || typeof value === "number") {
      renderLeafRow(container, key, path);
    } else if (Array.isArray(value)) {
      if (value.length === 0 || isPrimitiveArray(value)) {
        renderPrimitiveArray(container, key, path, value);
      } else {
        const wrap = document.createElement("details");
        wrap.setAttribute("data-path", pathId(path));
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
          if (wrap.open && !built) {
            built = true;
            value.forEach((v, i) =>
              renderEntry(childrenEl, "[" + i + "]", path.concat(i), v, depth + 1)
            );
            wrap.appendChild(childrenEl);
          }
        });
        container.appendChild(wrap);
      }
    } else if (isMatrixDef(value)) {
      renderMatrix(container, key, path, value);
    } else if (isPlainObject(value)) {
      renderObject(container, key, path, value, depth);
    } else {
      renderLeafRow(container, key, path);
    }
  }

  function renderRoot(preserveState) {
    // Save which nodes are open before destroying the DOM
    let openPaths = null;
    if (preserveState) {
      openPaths = collectOpenPaths();
    }

    mainEl.innerHTML = "";
    if (DATA === null) {
      mainEl.innerHTML =
        '<div class="loadbox"><p style="color:var(--dim)">Waiting for data…</p></div>';
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
    mainEl.appendChild(root);

    // Restore open/closed state
    if (openPaths && openPaths.size > 0) {
      restoreOpenPaths(openPaths);
    }
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

    // If this update is just our own edit echoing back, skip the re-render
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
      DATA = JSON.parse(text);
      renderRoot(true);  // true = preserve open/closed state
    } catch (e) {
      DATA = null;
      mainEl.innerHTML =
        '<div class="loadbox"><h2>⚠ Invalid JSON</h2>' +
        '<p style="color:var(--danger)">' +
        esc(e.message) +
        "</p></div>";
    }
  });

  vscode.postMessage({ type: "ready" });
})();