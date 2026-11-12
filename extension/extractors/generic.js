// Generic, site-independent extraction (isolated world, DOM only).
//  - findProblem(): readability-style scoring of text blocks
//  - findEditorsDOM(): scored editor candidates when no editor API exists
//  - languageLabels(): short texts from language pickers on the page
// scoreCodeText() is pure and unit-tested.
(function (root) {
  "use strict";

  const clean = (v) => String(v || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();

  // ---- DOM helpers ---------------------------------------------------------

  function shadowRoots() {
    const list = [];
    if (typeof document === "undefined") return list;
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    let guard = 0;
    while (node && guard++ < 50000) {
      if (node.shadowRoot) list.push(node.shadowRoot);
      node = walker.nextNode();
    }
    return list;
  }

  /** querySelectorAll across the document and every open shadow root. */
  function deepQueryAll(selector) {
    const out = [...document.querySelectorAll(selector)];
    for (const sr of shadowRoots()) out.push(...sr.querySelectorAll(selector));
    return out;
  }

  function deepQuery(selectors) {
    for (const sel of selectors) {
      try {
        for (const el of deepQueryAll(sel)) {
          if (isVisible(el) || el.tagName === "OPTION") return el;
        }
      } catch (_) {
        /* invalid selector on this browser: skip */
      }
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  function textOf(el) {
    if (!el) return "";
    if (el.tagName === "OPTION") return clean(el.text);
    if (el.tagName === "SELECT") return clean(el.selectedOptions[0] && el.selectedOptions[0].text);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return clean(el.value);
    return clean(el.innerText || el.textContent);
  }

  // ---- Code scoring (pure) -------------------------------------------------

  const CODE_TOKENS = /[{}();=<>\[\]]|\b(def|function|class|return|const|let|var|public|private|static|int|void|for|while|if|else|import|include|fn|func|struct|using|namespace)\b/g;

  /** 0..1: how much a text looks like source code. */
  function scoreCodeText(text) {
    const value = String(text || "");
    if (value.trim().length < 3) return 0;
    const lines = value.split("\n");
    const tokens = (value.match(CODE_TOKENS) || []).length;
    const density = Math.min(1, tokens / Math.max(8, value.length / 12));
    const indented = lines.filter((l) => /^(\t| {2,})\S/.test(l)).length / Math.max(1, lines.length);
    const multiLine = lines.length > 1 ? 0.15 : 0;
    const prose = (value.match(/[a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,}/gi) || []).length / Math.max(1, lines.length);
    return Math.max(0, Math.min(1, density * 0.6 + indented * 0.3 + multiLine - prose * 0.25));
  }

  // ---- Editors via DOM -----------------------------------------------------

  const MONO = /mono|consol|courier|menlo|fira|jetbrains|source code|cascadia/i;

  function findEditorsDOM() {
    const out = [];
    const active = document.activeElement;
    const push = (el, kind, code, base) => {
      if (!el || !code) return;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 1500 || !isVisible(el)) return;
      const mono = MONO.test(getComputedStyle(el).fontFamily) ? 0.15 : 0;
      const focus = active && (el === active || el.contains(active)) ? 0.15 : 0;
      const size = Math.min(0.2, area / 400000);
      const score = base + scoreCodeText(code) * 0.4 + mono + focus + size;
      out.push({ kind, code, score, el });
    };

    // Rendered (virtualised) editors: only visible lines, so lower base score.
    for (const el of deepQueryAll(".monaco-editor .view-lines")) {
      const lines = [...el.querySelectorAll(".view-line")]
        .sort((a, b) => parseFloat(a.style.top || 0) - parseFloat(b.style.top || 0))
        .map((l) => l.textContent.replace(/ /g, " "));
      push(el.closest(".monaco-editor") || el, "monaco-dom", clean(lines.join("\n")), 0.1);
    }
    for (const el of deepQueryAll(".cm-editor .cm-content, .CodeMirror-code")) {
      push(el, "codemirror-dom", clean(el.innerText), 0.15);
    }
    for (const el of deepQueryAll(".ace_editor .ace_text-layer")) {
      push(el.closest(".ace_editor") || el, "ace-dom", clean(el.innerText), 0.1);
    }
    for (const el of deepQueryAll("textarea")) {
      if (el.matches(".inputarea, .ace_text-input, .CodeMirror textarea") || el.closest("[data-scm-ignore]")) continue;
      push(el, "textarea", clean(el.value), 0.2);
    }
    for (const el of deepQueryAll('[contenteditable="true"], [contenteditable=""]')) {
      if (el.closest(".monaco-editor, .cm-editor, .ace_editor")) continue;
      push(el, "contenteditable", clean(el.innerText), 0.15);
    }
    for (const el of deepQueryAll("pre > code, pre")) {
      if (el.closest(".monaco-editor, .cm-editor, .ace_editor, .CodeMirror")) continue;
      // Read-only snippets are usually examples, not the student's attempt.
      push(el, "pre", clean(el.innerText), -0.15);
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ---- Problem statement (readability-style) -------------------------------

  const NEGATIVE = /(^|[\s_-])(nav|navbar|menu|footer|header|sidebar|side-bar|comment|comments|discuss|ad|ads|advert|promo|banner|cookie|consent|related|share|social|breadcrumb|toolbar|modal|popup|login|signup|newsletter)([\s_-]|$)/i;
  const POSITIVE = /problem|statement|description|question|challenge|task|prompt|content|article|instructions/i;
  const HEADING_HINT = /^\s*(problem|description|statement|task|input|output|constraints?|examples?|sample|explanation|note)\b/i;
  const BODY_HINT = /\b(input|output|constraints?|example|sample|return|given)\b/i;

  function classId(el) {
    return `${el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || ""} ${el.id || ""} ${el.getAttribute("role") || ""}`;
  }

  function insideIgnored(el) {
    return !!el.closest('nav, footer, header, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .monaco-editor, .cm-editor, .CodeMirror, .ace_editor, textarea, [contenteditable="true"], script, style, noscript');
  }

  function findProblem() {
    const scores = new Map();
    const add = (el, s) => el && el !== document.body && el !== document.documentElement && scores.set(el, (scores.get(el) || 0) + s);

    const blocks = deepQueryAll("p, pre, li, h1, h2, h3, h4, h5, blockquote, td, dd");
    for (const node of blocks.slice(0, 4000)) {
      if (insideIgnored(node)) continue;
      const text = clean(node.textContent);
      const isHeading = /^H[1-5]$/.test(node.tagName);
      if (text.length < (isHeading ? 4 : 25)) continue;
      let s = 1 + (text.match(/[,.]/g) || []).length * 0.25 + Math.min(text.length / 100, 3);
      if (isHeading && HEADING_HINT.test(text)) s += 6;
      if (BODY_HINT.test(text)) s += 1;
      const parent = node.parentElement;
      add(parent, s);
      add(parent && parent.parentElement, s / 2);
      add(parent && parent.parentElement && parent.parentElement.parentElement, s / 4);
    }

    let best = null;
    for (const [el, raw] of scores) {
      if (!isVisible(el)) continue;
      const ci = classId(el);
      let s = raw;
      if (NEGATIVE.test(ci)) s *= 0.3;
      if (POSITIVE.test(ci)) s *= 1.3;
      const text = el.innerText || "";
      const linkText = [...el.querySelectorAll("a")].reduce((n, a) => n + (a.innerText || "").length, 0);
      s *= 1 - Math.min(0.9, linkText / Math.max(1, text.length));
      // Containers that also wrap the editor are too broad.
      if (el.querySelector(".monaco-editor, .cm-editor, .CodeMirror, .ace_editor, textarea")) s *= 0.5;
      if (text.length > 15000) s *= 0.5;
      if (!best || s > best.score) best = { el, score: s };
    }
    if (!best || best.score < 4) return { text: "", confidence: 0, source: "none" };

    const text = clean(best.el.innerText).slice(0, 12000);
    const keywordHits = (text.match(/\b(input|output|constraints?|example|return)\b/gi) || []).length;
    const confidence = Math.min(0.85, 0.25 + best.score / 80 + Math.min(keywordHits, 4) * 0.05);
    return { text, confidence: Number(confidence.toFixed(2)), source: "heuristic", el: best.el };
  }

  // ---- Language pickers ----------------------------------------------------

  function languageLabels(extraSelectors = []) {
    const labels = [];
    for (const sel of extraSelectors) {
      try {
        const el = deepQuery([sel]);
        if (el) labels.push(textOf(el).slice(0, 60));
      } catch (_) {}
    }
    const L = root.SCM.language;
    // <select> elements whose options are mostly language names.
    for (const select of deepQueryAll("select")) {
      const options = [...select.options || []];
      const langOptions = options.filter((o) => L.fromLabel(o.text));
      if (langOptions.length >= 3 && select.selectedOptions[0]) labels.push(select.selectedOptions[0].text);
    }
    for (const el of deepQueryAll('[aria-label*="language" i], [class*="language-select" i], [class*="lang-select" i], [data-language], [class*="languageSelect" i]')) {
      const text = el.getAttribute("data-language") || textOf(el);
      if (text && text.length <= 40) labels.push(text);
    }
    return labels;
  }

  root.SCM = root.SCM || {};
  root.SCM.generic = { clean, deepQueryAll, deepQuery, isVisible, scoreCodeText, findEditorsDOM, findProblem, languageLabels, textOf };
  if (typeof module !== "undefined" && module.exports) module.exports = { scoreCodeText };
})(globalThis);
