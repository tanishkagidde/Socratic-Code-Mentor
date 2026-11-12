// Runs in the PAGE's main world (injected with chrome.scripting world:"MAIN").
//
// Why: content scripts live in an isolated world where window.monaco,
// element.CodeMirror and element.env.editor are always undefined. Only the
// page's own world can call the real editor APIs, which return the FULL
// text (Monaco only renders visible lines into the DOM).
//
// Protocol (same-window postMessage, structured-clone safe across worlds):
//   isolated -> main : {scm: "request", id}
//   main -> isolated : {scm: "editor", id, payload}
//   main -> isolated : {scm: "changed"}      editor content or language changed
//   main -> isolated : {scm: "navigated"}    SPA history navigation
(function () {
  "use strict";
  if (window.__scmBridge) {
    window.__scmBridge.rescan();
    return;
  }

  const attached = new WeakSet();
  let changeTimer = 0;

  function notifyChanged() {
    clearTimeout(changeTimer);
    // Small coalescing delay; the isolated side debounces further.
    changeTimer = setTimeout(() => window.postMessage({ scm: "changed" }, "*"), 60);
  }

  function rectInfo(el) {
    if (!el || !el.getBoundingClientRect) return { area: 0, visible: false };
    const r = el.getBoundingClientRect();
    const visible = r.width > 40 && r.height > 20 && getComputedStyle(el).visibility !== "hidden";
    return { area: Math.round(r.width * r.height), visible };
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  }

  // ---- Monaco ------------------------------------------------------------
  function monacoEditors() {
    const m = window.monaco && window.monaco.editor;
    if (!m) return [];
    const out = [];
    const editors = safe(() => m.getEditors(), []) || [];
    const seenModels = new Set();
    for (const ed of editors) {
      const model = safe(() => ed.getModel(), null);
      if (!model) continue;
      seenModels.add(model);
      if (!attached.has(ed)) {
        attached.add(ed);
        safe(() => ed.onDidChangeModelContent(notifyChanged));
        safe(() => ed.onDidChangeModel(notifyChanged));
        safe(() => ed.onDidChangeModelLanguage(notifyChanged));
      }
      const info = rectInfo(safe(() => ed.getDomNode(), null));
      out.push({
        kind: "monaco",
        code: safe(() => model.getValue(), ""),
        mode: safe(() => model.getLanguageId(), ""),
        focused: safe(() => ed.hasTextFocus(), false),
        readOnly: safe(() => ed.getOption(m.EditorOption.readOnly), false),
        ...info,
      });
    }
    // Models without an attached editor instance (some sites only expose models).
    if (!out.length) {
      for (const model of safe(() => m.getModels(), []) || []) {
        if (seenModels.has(model)) continue;
        if (!attached.has(model)) {
          attached.add(model);
          safe(() => model.onDidChangeContent(notifyChanged));
        }
        out.push({ kind: "monaco-model", code: safe(() => model.getValue(), ""), mode: safe(() => model.getLanguageId(), ""), area: 0, visible: true });
      }
    }
    if (!attached.has(m)) {
      attached.add(m);
      safe(() => m.onDidCreateEditor(() => setTimeout(notifyChanged, 50)));
      safe(() => m.onDidCreateModel(() => setTimeout(notifyChanged, 50)));
    }
    return out;
  }

  // ---- CodeMirror 5 ------------------------------------------------------
  function cm5Editors(root) {
    const out = [];
    for (const el of root.querySelectorAll(".CodeMirror")) {
      const cm = el.CodeMirror;
      if (!cm) continue;
      if (!attached.has(cm)) {
        attached.add(cm);
        safe(() => cm.on("change", notifyChanged));
        safe(() => cm.on("optionChange", notifyChanged));
      }
      out.push({ kind: "codemirror5", code: safe(() => cm.getValue(), ""), mode: safe(() => cm.getOption("mode"), ""), focused: safe(() => cm.hasFocus(), false), readOnly: !!safe(() => cm.getOption("readOnly"), false), ...rectInfo(el) });
    }
    return out;
  }

  // ---- CodeMirror 6 ------------------------------------------------------
  function cm6View(el) {
    const content = el.querySelector(".cm-content") || el;
    const tile = content.cmView || el.cmView;
    return (tile && (tile.view || (tile.rootView && tile.rootView.view))) || null;
  }

  function cm6Editors(root) {
    const out = [];
    for (const el of root.querySelectorAll(".cm-editor")) {
      const view = safe(() => cm6View(el), null);
      const code = view ? safe(() => view.state.doc.toString(), null) : null;
      if (code == null) continue;
      // CM6 has no public "listen after creation" hook; the isolated side
      // watches this node with a MutationObserver instead.
      const lang = safe(() => el.querySelector(".cm-content").getAttribute("data-language"), "");
      out.push({ kind: "codemirror6", code, mode: lang, focused: safe(() => view.hasFocus, false), ...rectInfo(el) });
    }
    return out;
  }

  // ---- Ace ---------------------------------------------------------------
  function aceEditors(root) {
    const out = [];
    for (const el of root.querySelectorAll(".ace_editor")) {
      const ed = (el.env && el.env.editor) || safe(() => window.ace && window.ace.edit(el), null);
      if (!ed) continue;
      if (!attached.has(ed)) {
        attached.add(ed);
        safe(() => ed.on("change", notifyChanged));
        safe(() => ed.session.on("changeMode", notifyChanged));
        safe(() => ed.on("changeSession", notifyChanged));
      }
      out.push({ kind: "ace", code: safe(() => ed.getValue(), ""), mode: safe(() => ed.session.getMode().$id, ""), focused: safe(() => ed.isFocused(), false), readOnly: safe(() => ed.getReadOnly(), false), ...rectInfo(el) });
    }
    return out;
  }

  // Open shadow roots: editors inside web components.
  function roots() {
    const list = [document];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    let guard = 0;
    while (node && guard++ < 50000) {
      if (node.shadowRoot) list.push(node.shadowRoot);
      node = walker.nextNode();
    }
    return list;
  }

  function collect() {
    const editors = [...monacoEditors()];
    for (const root of roots()) {
      editors.push(...cm5Editors(root), ...cm6Editors(root), ...aceEditors(root));
    }
    return editors
      .filter((e) => typeof e.code === "string")
      .map((e) => ({ ...e, mode: typeof e.mode === "object" && e.mode ? e.mode.name || "" : String(e.mode || "") }));
  }

  // ---- SPA navigation ----------------------------------------------------
  for (const fn of ["pushState", "replaceState"]) {
    const original = history[fn];
    history[fn] = function (...args) {
      const before = location.href;
      const ret = original.apply(this, args);
      if (location.href !== before) window.postMessage({ scm: "navigated" }, "*");
      return ret;
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.scm !== "request") return;
    let payload;
    try {
      payload = { editors: collect() };
    } catch (error) {
      payload = { editors: [], error: String(error && error.message) };
    }
    window.postMessage({ scm: "editor", id: event.data.id, payload }, "*");
  });

  window.__scmBridge = { rescan: notifyChanged };
  notifyChanged();
})();
