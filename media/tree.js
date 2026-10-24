/*
 * The editable tree, shared by the editor (main.js, one file) and the compare view
 * (compare.js, two files). Exposed as window.ConfigTree.create(opts).
 *
 * With two files ("sides") each row has a value column per file. Rows cover the keys of
 * every file; a file without that key shows a blank placeholder.
 */
(function () {
  const {
    isPlainObject,
    isMatrixDef,
    isPrimitiveArray,
    setAtPath,
    pathId,
    coerce,
    emptyLike,
    searchData,
    diffData,
  } = window.ConfigEditorUtil;

  const MISSING = { missing: true };
  const STATUSES = ["changed", "added", "removed"];
  const MAX_HISTORY = 50;

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function isContainer(v) {
    return Array.isArray(v) || isPlainObject(v);
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function diffLabel(node) {
    if (!node || node.status === "same") return "same";
    if (node.status === "added" || node.status === "removed") return node.status;
    return plural(node.changes, "difference");
  }

  /**
   * opts.sides       number of files: 1 (editor) or 2 (compare)
   * opts.onEdit      (side, data) => void, sends an edited file to the extension
   * opts.toast       (message) => void
   * opts.scroller    the scrolling element, so re-renders keep the scroll position
   * opts.search      optional { input, count } elements for the search box
   * opts.onStatus    optional (diff) => void, called whenever the compare diff is recomputed
   */
  function create(opts) {
    const n = opts.sides;
    const compare = n > 1;
    const data = new Array(n).fill(null);

    const shown = data.map((_, side) => side);
    let container = null;
    let onlyDiff = false;

    const expanded = new Set();
    const collapsed = new Set(); // compare: changed nodes the user closed, which otherwise open by default
    let diff = null;
    let status = new Map(); // pathId → diff node

    function lookup(side, path) {
      let v = data[side];
      for (const k of path) {
        if (v === null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, k)) {
          return MISSING;
        }
        v = v[k];
      }
      return v;
    }

    function valuesAt(path) {
      return data.map((_, s) => lookup(s, path));
    }

    /** How a path is shown, based on the files that have it */
    function kindOf(values) {
      const present = values.filter((v) => v !== MISSING);
      if (present.every(Array.isArray)) {
        return present.every(isPrimitiveArray) ? "list" : "array";
      }
      if (present.every(isMatrixDef)) return "matrix";
      if (present.every(isPlainObject)) return "object";
      return "leaf";
    }

    /** Keys below a path across all files: the first file's order, then keys only the others have */
    function childKeys(path) {
      const keys = [];
      const seen = new Set();
      let array = false;
      const add = (k) => {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      };
      for (let s = 0; s < n; s++) {
        const v = lookup(s, path);
        if (Array.isArray(v)) {
          array = true;
          v.forEach((_, i) => add(i));
        } else if (isPlainObject(v)) {
          Object.keys(v).forEach(add);
        }
      }
      return { keys, array };
    }

    function statusOf(path) {
      const node = status.get(pathId(path));
      return node ? node.status : "same";
    }

    function computeStatus() {
      status = new Map();
      if (!compare) return;
      diff = diffData(data[0], data[1]);
      (function walk(node, path) {
        status.set(pathId(path), node);
        if (node.children) node.children.forEach((c) => walk(c.node, path.concat(c.key)));
      })(diff, []);
      if (opts.onStatus) opts.onStatus(diff);
    }

    /* ════════════════  editing & undo  ════════════════ */

    const undoStack = [];
    const redoStack = [];
    const editTimers = new Array(n).fill(null);

    function snapshot() {
      return { text: JSON.stringify(data), expanded: Array.from(expanded) };
    }

    /** Call before any change to the data */
    function beforeEdit() {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0; // clear redo on new edit
    }

    function postEdit(side) {
      if (data[side] !== null) opts.onEdit(side, data[side]);
    }

    function notifyEdit(side) {
      clearTimeout(editTimers[side]);
      editTimers[side] = setTimeout(() => {
        editTimers[side] = null;
        postEdit(side);
      }, 500);
    }

    function flushEdits() {
      editTimers.forEach((t, side) => {
        if (t === null) return;
        clearTimeout(t);
        editTimers[side] = null;
        postEdit(side);
      });
    }

    let decorateQueued = false;
    function afterEdit(side) {
      notifyEdit(side);
      if (!compare || decorateQueued) return;
      decorateQueued = true;
      requestAnimationFrame(() => {
        decorateQueued = false;
        decorate();
      });
    }

    function restore(from, to, message) {
      if (!from.length || data.includes(null)) return;
      const before = data.map((d) => JSON.stringify(d));
      to.push(snapshot());
      const state = from.pop();
      JSON.parse(state.text).forEach((d, side) => (data[side] = d));
      expanded.clear();
      state.expanded.forEach((p) => expanded.add(p));
      rerender();
      data.forEach((d, side) => {
        if (JSON.stringify(d) !== before[side]) postEdit(side);
      });
      opts.toast(message);
    }

    document.addEventListener("keydown", (e) => {
      if (opts.search && e.target === opts.search.input) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        restore(undoStack, redoStack, "Undo");
      } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        restore(redoStack, undoStack, "Redo");
      }
    });

    document.addEventListener("focusout", flushEdits);

    /* ════════════════  building blocks  ════════════════ */

    /**
     * A text field for one file's value. Missing values get a disabled placeholder field;
     * objects and lists (when the other file has a plain value here) are shown read-only.
     */
    function valueInput(side, value, write) {
      const input = document.createElement("input");
      input.type = "text";
      if (compare) input.setAttribute("data-side", side);
      if (value === MISSING) {
        input.disabled = true;
        input.className = "ghost";
        return input;
      }
      if (isContainer(value)) {
        input.disabled = true;
        input.value = JSON.stringify(value);
        input.title = input.value;
        return input;
      }
      input.value = String(value ?? "");
      input.addEventListener("focus", () => {
        input._before = input.value;
      });
      input.addEventListener("input", () => {
        if (input._snapshotted !== input._before) {
          beforeEdit();
          input._snapshotted = input._before;
        }
        write(coerce(input.value, value));
        afterEdit(side);
      });
      return input;
    }

    function iconButton(label, title, onClick) {
      const b = document.createElement("button");
      b.className = "ghost icon";
      if (!onClick) {
        // invisible, keeps entries lined up where the other file has buttons
        b.classList.add("placeholder");
        b.tabIndex = -1;
        return b;
      }
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", onClick);
      return b;
    }

    function isOpen(id, byDefault) {
      return expanded.has(id) || (byDefault && !collapsed.has(id));
    }

    /** A foldable node; its body is built the first time it opens */
    function foldable(container, id, depth, keyHtml, badgeText, build, openByDefault) {
      const wrap = document.createElement("details");
      wrap.setAttribute("data-path", id);
      wrap.classList.add("depth-" + (depth % 5));
      const summary = document.createElement("summary");
      summary.innerHTML =
        '<span class="arrow">▸</span>' + keyHtml + '<span class="badge">' + esc(badgeText) + "</span>";
      wrap.appendChild(summary);

      let built = false;
      const buildOnce = () => {
        if (built) return;
        built = true;
        build(wrap);
        paint(wrap);
      };
      wrap._forceBuild = buildOnce;
      if (isOpen(id, openByDefault)) {
        wrap.open = true;
        buildOnce();
      }
      wrap.addEventListener("toggle", () => {
        if (wrap.open) {
          expanded.add(id);
          collapsed.delete(id);
          buildOnce();
        } else {
          expanded.delete(id);
          collapsed.add(id);
        }
      });
      container.appendChild(wrap);
      return wrap;
    }

    /* ════════════════  renderers  ════════════════ */

    function renderLeafRow(container, key, path, depth) {
      const row = document.createElement("div");
      row.className = "row";
      row.setAttribute("data-path", pathId(path));
      row.style.setProperty("--depth", depth);
      const label = document.createElement("div");
      label.className = "key depth-" + (depth % 5);
      label.textContent = key;
      row.appendChild(label);
      shown.forEach((side) =>
        row.appendChild(valueInput(side, lookup(side, path), (v) => setAtPath(data[side], path, v)))
      );
      container.appendChild(row);
    }

    function renderList(container, key, path, depth) {
      const id = pathId(path);
      const body = document.createElement("div");
      body.className = "arrwrap";

      const lengths = () =>
        data.map((_, s) => {
          const v = lookup(s, path);
          return Array.isArray(v) ? v.length : -1;
        });
      const countText = () => plural(lengths()[0], "item");

      /** Structural change: snapshot, change the list, re-render it, save right away */
      function change(side, mutate, focusIndex) {
        beforeEdit();
        mutate(lookup(side, path));
        renderItems();
        if (!compare) wrap.querySelector("summary .badge").textContent = countText();
        afterEdit(side);
        flushEdits();
        if (focusIndex === undefined) return;
        const len = lengths()[side];
        const row = body.children[Math.min(focusIndex, len - 1)];
        const cell = row && row.children[side];
        const input = cell && cell.querySelector("input:not(:disabled)");
        if (input) {
          input.focus();
          input.select();
        }
      }

      function addItem(side) {
        const items = lookup(side, path);
        change(side, (a) => a.push(emptyLike(items[items.length - 1])), items.length);
      }

      function cell(side, i, len) {
        const el = document.createElement("div");
        el.className = "arrcell";
        if (len === 0 && i === 0) {
          const empty = document.createElement("span");
          empty.className = "arrempty";
          empty.textContent = "empty list";
          el.append(empty, iconButton("+", "Add entry", () => addItem(side)));
          return el;
        }
        if (i >= len) {
          // this file's list is shorter, or it has no list here
          el.append(valueInput(side, MISSING), iconButton(), iconButton());
          return el;
        }
        const original = lookup(side, path)[i];
        const input = valueInput(side, original, (v) => (lookup(side, path)[i] = v));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && i === len - 1) {
            e.preventDefault();
            addItem(side);
          }
        });
        const remove = iconButton("−", "Remove entry", () => change(side, (a) => a.splice(i, 1), i));
        const add = iconButton("+", "Add entry", () => addItem(side));
        if (i !== len - 1) add.classList.add("placeholder");
        el.append(input, remove, add);
        return el;
      }

      function renderItems() {
        body.innerHTML = "";
        const lens = lengths();
        const rows = Math.max(1, ...lens);
        for (let i = 0; i < rows; i++) {
          const row = document.createElement("div");
          row.className = "arritem";
          row.style.setProperty("--depth", depth);
          if (lens.some((len) => i < len)) row.setAttribute("data-path", pathId(path.concat(i)));
          shown.forEach((side) => row.appendChild(cell(side, i, lens[side])));
          body.appendChild(row);
        }
      }

      function build(wrap) {
        renderItems();
        wrap.appendChild(body);
      }

      const keyHtml = '<span class="key leaf-key">' + esc(key) + "</span>";
      const wrap = foldable(container, id, depth, keyHtml, compare ? "" : countText(), build, false);
      wrap.classList.add("leaf-array");
    }

    function matrixTable(side, path, def) {
      const table = document.createElement("table");
      table.className = "matrix";

      const thead = document.createElement("tr");
      thead.appendChild(document.createElement("th"));
      def.labels_cols.forEach((c, j) => {
        const th = document.createElement("th");
        th.setAttribute("data-path", pathId(path.concat("labels_cols", j)));
        th.textContent = c;
        thead.appendChild(th);
      });
      table.appendChild(thead);

      function setCell(i, j, v) {
        const values = lookup(side, path).values;
        if (!Array.isArray(values[i])) values[i] = [];
        values[i][j] = v;
      }

      def.labels_rows.forEach((r, i) => {
        const tr = document.createElement("tr");
        const td0 = document.createElement("td");
        td0.className = "rowlabel";
        td0.setAttribute("data-path", pathId(path.concat("labels_rows", i)));
        td0.textContent = r;
        tr.appendChild(td0);

        def.labels_cols.forEach((_c, j) => {
          const td = document.createElement("td");
          td.setAttribute("data-path", pathId(path.concat("values", i, j)));
          const val = (def.values[i] || [])[j];
          if (val === "0" || val === "1") {
            const cb = document.createElement("input");
            cb.type = "checkbox";
            if (compare) cb.setAttribute("data-side", side);
            cb.checked = val === "1";
            cb.addEventListener("change", () => {
              beforeEdit();
              setCell(i, j, cb.checked ? "1" : "0");
              afterEdit(side);
            });
            td.appendChild(cb);
          } else {
            td.appendChild(valueInput(side, val, (v) => setCell(i, j, v)));
          }
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      return table;
    }

    function renderMatrix(container, key, path, depth) {
      const id = pathId(path);
      const defs = valuesAt(path);
      const first = defs.find((d) => d !== MISSING);
      const body = document.createElement("div");

      function build(wrap) {
        if (!compare) {
          body.appendChild(matrixTable(0, path, defs[0]));
        } else {
          body.className = "mtables";
          body.style.setProperty("--depth", depth);
          shown.forEach((side) => {
            const slot = document.createElement("div");
            slot.className = "mslot";
            if (defs[side] === MISSING) slot.appendChild(valueInput(side, MISSING));
            else slot.appendChild(matrixTable(side, path, defs[side]));
            body.appendChild(slot);
          });
        }
        wrap.appendChild(body);
      }

      const keyHtml = '<span class="key">' + esc(key) + "</span>";
      const badge = compare ? "" : first.labels_rows.length + "×" + first.labels_cols.length;
      foldable(container, id, depth, keyHtml, badge, build, true);
    }

    function renderBranch(container, key, path, depth, kind) {
      const id = pathId(path);
      const childrenEl = document.createElement("div");
      childrenEl.className = "children";

      function build(wrap) {
        renderChildren(childrenEl, path, depth + 1);
        wrap.appendChild(childrenEl);
      }

      let badge = "";
      if (!compare) {
        const v = lookup(0, path);
        badge = kind === "array" ? v.length + " items" : plural(Object.keys(v).length, "field");
      }
      const keyHtml = '<span class="key">' + esc(key) + "</span>";
      foldable(container, id, depth, keyHtml, badge, build, statusOf(path) === "changed");
    }

    function renderEntry(container, key, path, depth) {
      const kind = kindOf(valuesAt(path));
      if (kind === "leaf") renderLeafRow(container, key, path, depth);
      else if (kind === "list") renderList(container, key, path, depth);
      else if (kind === "matrix") renderMatrix(container, key, path, depth);
      else renderBranch(container, key, path, depth, kind);
    }

    function renderChildren(container, path, depth) {
      const { keys, array } = childKeys(path);
      keys.forEach((k) => {
        const childPath = path.concat(k);
        // hide equal fields; decided when rendering, so a field you just edited doesn't vanish
        if (onlyDiff && statusOf(childPath) === "same") return;
        renderEntry(container, array ? "[" + k + "]" : k, childPath, depth);
      });
    }

    /** Status classes and difference counts, updated in place so editing keeps focus */
    function decorate() {
      if (!compare || !container) return;
      computeStatus();
      paint(container);
    }

    function paint(within) {
      if (!compare) return;
      const els = Array.from(within.querySelectorAll("[data-path]"));
      if (within.hasAttribute("data-path")) els.push(within);
      els.forEach((el) => {
        const node = status.get(el.getAttribute("data-path"));
        const st = node ? node.status : "same";
        STATUSES.forEach((s) => el.classList.toggle("status-" + s, s === st));
        if (el.tagName === "DETAILS") {
          el.querySelector(":scope > summary .badge").textContent = diffLabel(node);
        }
      });
    }

    function rerender() {
      if (container) render(container);
    }

    /** Render (again) into `target`, keeping folds, scroll position and the search filter */
    function render(target) {
      container = target;
      const scroll = opts.scroller ? opts.scroller.scrollTop : 0;
      computeStatus();

      container.innerHTML = "";
      container.classList.add("tree");
      container.classList.toggle("columns", compare);
      renderChildren(container, [], 0);
      decorate();
      if (opts.scroller) opts.scroller.scrollTop = scroll;
      applyFilter();
    }

    /* ════════════════  search  ════════════════ */

    const searchEl = opts.search && opts.search.input;
    const searchCountEl = opts.search && opts.search.count;
    let searchTimer = null;
    let hitEls = [];
    let hitIndex = -1;
    // open/closed state from before the search started, put back when it is cleared
    let preSearchOpen = null;

    function searchAll(query) {
      const result = { hits: new Map(), parents: new Set(), visible: new Set() };
      data.forEach((d) => {
        const r = searchData(d, query);
        r.hits.forEach((kind, id) => {
          if (!result.hits.has(id)) result.hits.set(id, kind);
        });
        r.parents.forEach((id) => result.parents.add(id));
        r.visible.forEach((id) => result.visible.add(id));
      });
      return result;
    }

    function snapshotOpenState() {
      const open = new Map();
      container.querySelectorAll("details[data-path]").forEach((d) =>
        open.set(d.getAttribute("data-path"), d.open)
      );
      return { open, expanded: new Set(expanded) };
    }

    function restorePreSearchState() {
      const { open, expanded: wasExpanded } = preSearchOpen;
      preSearchOpen = null;
      container.querySelectorAll("details[data-path]").forEach((d) => {
        const id = d.getAttribute("data-path");
        d.open = open.has(id) ? open.get(id) : wasExpanded.has(id);
      });
    }

    function updateSearchCount() {
      if (!searchEl.value.trim()) searchCountEl.textContent = "";
      else if (!hitEls.length) searchCountEl.textContent = "No results";
      else if (hitIndex < 0) searchCountEl.textContent = hitEls.length + (hitEls.length === 1 ? " match" : " matches");
      else searchCountEl.textContent = hitIndex + 1 + " of " + hitEls.length;
    }

    function goToHit(index) {
      // editing a list re-renders its entries, dropping their hit elements
      hitEls = hitEls.filter((el) => el.isConnected);
      if (!hitEls.length) return updateSearchCount();
      if (hitIndex >= 0 && hitEls[hitIndex]) hitEls[hitIndex].classList.remove("hit-current");
      hitIndex = (index + hitEls.length) % hitEls.length;
      const el = hitEls[hitIndex];
      el.classList.add("hit-current");
      el.scrollIntoView({ block: "center" });
      updateSearchCount();
    }

    /** Filter the tree to the search hits; jump=true scrolls to the first one */
    function applyFilter(jump) {
      if (!searchEl || !container) return;
      const query = searchEl.value;
      const active = query.trim() !== "";

      if (active && !preSearchOpen) preSearchOpen = snapshotOpenState();
      if (!active && preSearchOpen) restorePreSearchState();

      const { hits, parents, visible } = searchAll(query);

      // open every node with a hit below it; opening builds children, so repeat
      let opened;
      do {
        opened = 0;
        container.querySelectorAll("details[data-path]:not([open])").forEach((d) => {
          if (!parents.has(d.getAttribute("data-path"))) return;
          d.open = true;
          if (d._forceBuild) d._forceBuild();
          opened++;
        });
      } while (opened);

      container.querySelectorAll("[data-path]").forEach((el) => {
        const id = el.getAttribute("data-path");
        const kind = hits.get(id);
        el.classList.toggle("hit", !!kind);
        el.classList.toggle("hit-key", kind === "key");
        el.classList.toggle("hit-value", kind === "value");
        el.classList.remove("hit-current");
        // list entries and matrix cells stay visible; only whole fields are filtered
        if (el.matches(".row, details")) {
          el.style.display = !active || visible.has(id) ? "" : "none";
        }
      });

      hitEls = Array.from(container.querySelectorAll(".hit"));
      hitIndex = -1;
      if (jump && hitEls.length) goToHit(0);
      else updateSearchCount();
    }

    function runSearch() {
      clearTimeout(searchTimer);
      searchTimer = null;
      applyFilter(true);
    }

    if (searchEl) {
      searchEl.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 150);
      });

      searchEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (searchTimer !== null) runSearch();
          else if (hitIndex < 0) goToHit(e.shiftKey ? -1 : 0);
          else goToHit(hitIndex + (e.shiftKey ? -1 : 1));
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (searchEl.value) {
            searchEl.value = "";
            runSearch();
          } else {
            searchEl.blur();
          }
        }
      });

      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          searchEl.focus();
          searchEl.select();
        }
      });
    }

    /* ════════════════  public  ════════════════ */

    return {
      render,
      flushEdits,

      getData(side) {
        return data[side];
      },

      /** New content from the extension; returns false when it is what the tree already shows */
      setData(side, value) {
        if (value !== null && data[side] !== null && JSON.stringify(data[side]) === JSON.stringify(value)) {
          return false;
        }
        // the file changed outside this view; old history would undo those changes too
        undoStack.length = 0;
        redoStack.length = 0;
        data[side] = value;
        return true;
      },

      setOnlyDiff(value) {
        onlyDiff = value;
      },

      diff() {
        return diff;
      },

      expandAll() {
        if (!container) return;
        // building a node adds new closed <details>, so repeat until none are left
        let closed;
        while ((closed = container.querySelectorAll("details:not([open])")).length) {
          closed.forEach((d) => {
            d.open = true;
            if (d._forceBuild) d._forceBuild();
          });
        }
      },

      collapseAll() {
        if (!container) return;
        container.querySelectorAll("details").forEach((d) => (d.open = false));
      },
    };
  }

  window.ConfigTree = { create };
})();
