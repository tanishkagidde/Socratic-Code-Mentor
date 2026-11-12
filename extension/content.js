// Isolated-world orchestrator. Injected on demand by the side panel (with
// extractors/*.js before it and bridge-main.js in the MAIN world), into every
// frame we have access to. Each frame reports its best guess; the panel
// merges frames and keeps the best problem and code.
//
// Live sync: editor API change events (via the bridge), input events,
// MutationObservers and SPA navigation all funnel into one debounced
// snapshot that is only sent when something actually changed.
(function () {
  "use strict";
  // Re-injected into a page that already has a live copy: just resend.
  // A copy left over from before an extension reload is dead: replace it.
  if (window.__scmContent && window.__scmContent.isAlive()) {
    window.__scmContent.rescan(true);
    return;
  }
  if (window.__scmContent) window.__scmContent.shutdown();

  const { generic, adapters, language } = globalThis.SCM;
  const DEBOUNCE_MS = 350;
  const adapter = adapters.find(location.hostname);

  let timer = 0;
  let lastSent = "";
  let lastHref = location.href;
  let lastProblemConfidence = 1;
  let problemEl = null;
  let watchedCodeEl = null;
  let codeObserver = null;
  let alive = true;

  // ---- Bridge (MAIN world) ---------------------------------------------------

  let reqSeq = 0;
  const pending = new Map();

  function requestBridge(timeout = 250) {
    const id = `scm-${Date.now()}-${++reqSeq}`;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, timeout);
      pending.set(id, (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
      window.postMessage({ scm: "request", id }, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data.scm !== "string") return;
    const { scm, id, payload } = event.data;
    if (scm === "editor" && pending.has(id)) {
      pending.get(id)(payload);
      pending.delete(id);
    } else if (scm === "changed") {
      schedule();
    } else if (scm === "navigated") {
      problemEl = null;
      schedule(500);
    }
  });

  // ---- Extraction ------------------------------------------------------------

  function pickApiEditor(editors) {
    let best = null;
    for (const e of editors) {
      if (typeof e.code !== "string") continue;
      const s =
        (e.visible ? 2 : 0) +
        Math.min(1.5, (e.area || 0) / 150000) +
        (e.focused ? 1 : 0) +
        Math.min(0.5, e.code.length / 2000) +
        generic.scoreCodeText(e.code) * 0.5 -
        (e.readOnly ? 1.5 : 0);
      if (!best || s > best.s) best = { e, s };
    }
    return best && best.e;
  }

  function adapterProblem() {
    if (!adapter) return null;
    const el = generic.deepQuery(adapter.problem);
    const text = el ? generic.textOf(el).slice(0, 12000) : "";
    return text.length >= 60 ? { text, confidence: 0.95, source: `adapter`, el } : null;
  }

  function selectionText() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (node && node.closest(".monaco-editor, .cm-editor, .CodeMirror, .ace_editor, textarea")) return "";
    return generic.clean(sel.toString()).slice(0, 12000);
  }

  async function snapshot() {
    const url = new URL(location.href);

    // Code: real editor APIs first, DOM heuristics second.
    const bridge = await requestBridge();
    const apiEditor = pickApiEditor((bridge && bridge.editors) || []);
    let code = "";
    let codeConfidence = 0;
    let codeSource = "none";
    let editorMode = "";
    let codeEl = null;
    if (apiEditor) {
      code = apiEditor.code;
      codeConfidence = 0.95;
      codeSource = apiEditor.kind;
      editorMode = apiEditor.mode;
    } else {
      const dom = generic.findEditorsDOM()[0];
      if (dom && dom.score > 0.2) {
        code = dom.code;
        codeEl = dom.el;
        codeSource = dom.kind;
        codeConfidence = Number(Math.max(0.2, Math.min(0.8, dom.score)).toFixed(2));
      }
    }
    watchCodeElement(codeEl || document.querySelector(".cm-editor .cm-content"));

    // Problem: adapter, then readability heuristic, then the user's selection.
    let problem = adapterProblem() || generic.findProblem();
    const selected = selectionText();
    if (problem.confidence < 0.5 && selected.length >= 60) {
      problem = { text: selected, confidence: 0.8, source: "selection" };
    }
    problemEl = problem.el || null;
    lastProblemConfidence = problem.confidence;

    const titleEl = adapter && adapter.title ? generic.deepQuery(adapter.title) : null;
    const title = generic.clean((titleEl && titleEl.innerText) || document.title).slice(0, 160);
    const labels = generic.languageLabels((adapter && adapter.language) || []);
    const lang = language.detect({ editorMode, labels, url: location.href, code });
    const pathKey = adapter && adapter.problemKey ? adapter.problemKey(url) : url.pathname;

    return {
      isTop: window === window.top,
      url: location.href,
      site: adapter ? adapter.name : url.hostname.replace(/^www\./, ""),
      title,
      problem: problem.text,
      problemConfidence: problem.confidence,
      problemSource: problem.source,
      code,
      codeConfidence,
      codeSource,
      language: lang,
      problemKey: `${url.hostname}${pathKey}|${title.slice(0, 80)}`,
      hasSelection: selected.length >= 20,
    };
  }

  async function send(force = false) {
    if (!alive) return;
    if (!chrome.runtime || !chrome.runtime.id) return shutdown(); // extension reloaded
    let data;
    try {
      data = await snapshot();
    } catch (error) {
      data = { error: String((error && error.message) || error), url: location.href, isTop: window === window.top };
    }
    const key = JSON.stringify(data);
    if (!force && key === lastSent) return;
    lastSent = key;
    chrome.runtime.sendMessage({ type: "SCM_SNAPSHOT", data }).catch(() => {
      /* panel closed: nothing is listening, that's fine */
    });
  }

  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => send(false), delay);
  }

  // ---- Watchers --------------------------------------------------------------

  function watchCodeElement(el) {
    if (el === watchedCodeEl) return;
    if (codeObserver) codeObserver.disconnect();
    watchedCodeEl = el;
    if (!el) return;
    codeObserver = new MutationObserver(() => schedule());
    codeObserver.observe(el, { characterData: true, childList: true, subtree: true });
  }

  const onInput = (e) => {
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) schedule();
  };
  document.addEventListener("input", onInput, true);

  const onNav = () => {
    problemEl = null;
    schedule(500);
  };
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);

  const onSelection = () => {
    if (lastProblemConfidence < 0.5) schedule(600);
  };
  document.addEventListener("selectionchange", onSelection);

  // Cheap check on DOM churn: only rescan when the URL changed or the problem
  // element we found was replaced (new problem loaded in an SPA).
  let churnPending = false;
  const pageObserver = new MutationObserver(() => {
    if (churnPending) return;
    churnPending = true;
    setTimeout(() => {
      churnPending = false;
      if (location.href !== lastHref || (problemEl && !problemEl.isConnected) || (!problemEl && lastProblemConfidence < 0.5)) {
        lastHref = location.href;
        schedule(500);
      }
    }, 800);
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });

  const onMessage = (message, _sender, sendResponse) => {
    if (message && message.type === "SCM_RESCAN") {
      send(true);
      sendResponse({ ok: true });
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  function shutdown() {
    alive = false;
    clearTimeout(timer);
    pageObserver.disconnect();
    if (codeObserver) codeObserver.disconnect();
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("selectionchange", onSelection);
    window.removeEventListener("popstate", onNav);
    window.removeEventListener("hashchange", onNav);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch (_) {}
    if (window.__scmContent && window.__scmContent.shutdown === shutdown) window.__scmContent = null;
  }

  window.__scmContent = {
    rescan: (force) => send(!!force),
    isAlive: () => alive && !!(chrome.runtime && chrome.runtime.id),
    shutdown,
  };
  send(true);
})();
