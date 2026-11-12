// Guidance cards. Everything from the model is inserted with textContent
// (never innerHTML), so model output can't inject markup.
(function () {
  "use strict";

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FORMATS = {
    analogy: { label: "Analogy" },
    worked_example: { label: "Worked example", mono: true },
    trace_table: { label: "Trace table", mono: true },
    counterexample: { label: "Counterexample" },
    visual_ascii: { label: "Sketch", mono: true },
    question_ladder: { label: "Question ladder" },
  };

  const STATUS = {
    incomplete: { label: "Getting started", line: "Let's build it up, one idea at a time.", mood: "idle" },
    likely_bug: { label: "Something to check", line: "Found something worth a closer look.", mood: "curious" },
    nearly_correct: { label: "Almost there", line: "Nice, you're close!", mood: "happy" },
    appears_complete: { label: "Looks complete", line: "That looks solid. Great work!", mood: "happy" },
    insufficient_context: { label: "Need more context", line: "I need a bit more to go on.", mood: "confused" },
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // `code` and **bold** inside model text, safely.
  function inline(parent, text) {
    const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("`") && part.endsWith("`")) parent.append(el("code", null, part.slice(1, -1)));
      else if (part.startsWith("**") && part.endsWith("**")) parent.append(el("strong", null, part.slice(2, -2)));
      else parent.append(document.createTextNode(part));
    }
    return parent;
  }

  function richText(container, text, format) {
    container.replaceChildren();
    if (format === "trace_table" || format === "visual_ascii") {
      container.append(el("pre", "block-pre", text));
      return;
    }
    let list = null;
    for (const raw of String(text).split("\n")) {
      const line = raw.trim();
      if (!line) {
        list = null;
        continue;
      }
      const bullet = line.match(/^([-•*]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        const ordered = /\d/.test(bullet[1]) || format === "question_ladder";
        if (!list || list.tagName !== (ordered ? "OL" : "UL")) {
          list = el(ordered ? "ol" : "ul");
          container.append(list);
        }
        list.append(inline(el("li"), bullet[2]));
      } else if (format === "question_ladder" && /\?\s*$/.test(line)) {
        if (!list || list.tagName !== "OL") {
          list = el("ol");
          container.append(list);
        }
        list.append(inline(el("li"), line));
      } else {
        list = null;
        container.append(inline(el("p"), line));
      }
    }
  }

  // ---- Typewriter: smooths the chunky stream into flowing text -------------
  const typed = new Map(); // node -> {target, shown, paint}
  let raf = 0;

  function typeInto(node, target, paint) {
    const entry = typed.get(node) || { shown: "", paint };
    entry.target = String(target || "");
    entry.paint = paint;
    if (!entry.target.startsWith(entry.shown)) entry.shown = "";
    typed.set(node, entry);
    if (reduceMotion()) {
      entry.shown = entry.target;
      entry.paint(node, entry.shown);
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = 0;
    let busy = false;
    for (const [node, e] of typed) {
      if (e.shown.length < e.target.length) {
        const step = Math.max(2, Math.ceil((e.target.length - e.shown.length) / 6));
        e.shown = e.target.slice(0, e.shown.length + step);
        e.paint(node, e.shown);
        busy = true;
      }
    }
    if (busy) raf = requestAnimationFrame(tick);
  }

  function flushTyping() {
    for (const [node, e] of typed) {
      e.shown = e.target;
      e.paint(node, e.shown);
    }
    typed.clear();
  }

  const paintText = (node, text) => (node.textContent = text);

  // ---- Cards ---------------------------------------------------------------

  const Render = {
    FORMATS,
    STATUS,
    root: null,
    cards: null,

    init(root) {
      Render.root = root;
    },

    clear() {
      typed.clear();
      Render.cards = null;
      Render.root.replaceChildren();
      Render.root.setAttribute("aria-busy", "false");
    },

    skeleton(note = "Reading your code…") {
      Render.clear();
      Render.root.setAttribute("aria-busy", "true");
      const card = el("div", "card skeleton");
      card.append(el("div", "sk-line sk-title"), el("div", "sk-line"), el("div", "sk-line short"));
      const dots = el("div", "thinking", note);
      dots.append(el("span", "dots"));
      Render.root.append(dots, card, el("div", "card skeleton small"));
    },

    // Lazily create the card skeletons the first time a field streams in.
    ensureCards() {
      if (Render.cards) return Render.cards;
      Render.root.replaceChildren();
      const c = {};

      c.hero = el("article", "card hero slide-in");
      const top = el("div", "hero-top");
      c.status = el("span", "status-pill");
      top.append(el("span", "eyebrow", "Concept gap"), c.status);
      c.name = el("h2", "gap-name");
      c.oneLine = el("p", "gap-line");
      c.why = el("p", "gap-why");
      c.hero.append(top, c.name, c.oneLine, c.why);

      c.teach = el("article", "card teach slide-in");
      c.teach.hidden = true;
      const teachHead = el("div", "card-head");
      c.badge = el("span", "badge");
      c.teachLabel = el("span", "eyebrow", "Learn it");
      teachHead.append(c.teachLabel, c.badge);
      c.teachBody = el("div", "teach-body");
      c.teach.append(teachHead, c.teachBody);

      c.tryCard = el("article", "card try slide-in");
      c.tryCard.hidden = true;
      c.tryLabel = el("label", "try-row");
      c.tryBox = el("input");
      c.tryBox.type = "checkbox";
      c.tryText = el("span", "try-text");
      c.tryLabel.append(c.tryBox, c.tryText);
      c.tryCard.append(el("span", "eyebrow", "Try this next"), c.tryLabel);

      c.check = el("article", "card check slide-in");
      c.check.hidden = true;
      c.checkBtn = el("button", "reveal", "Reveal a check question");
      c.checkBtn.setAttribute("aria-expanded", "false");
      c.checkText = el("p", "check-text");
      c.checkText.hidden = true;
      c.checkBtn.addEventListener("click", () => {
        c.checkText.hidden = false;
        c.checkBtn.setAttribute("aria-expanded", "true");
        c.checkBtn.textContent = "Check yourself";
        c.checkBtn.disabled = true;
      });
      c.check.append(el("span", "eyebrow", "Check your understanding"), c.checkBtn, c.checkText);

      c.more = el("details", "card more slide-in");
      c.more.hidden = true;
      c.more.append(el("summary", null, "Show more"));
      c.moreList = el("dl", "more-list");
      c.more.append(c.moreList);

      c.actions = el("div", "result-actions");
      c.actions.hidden = true;

      Render.root.append(c.hero, c.teach, c.tryCard, c.check, c.more, c.actions);
      Render.cards = c;
      return c;
    },

    /** Apply a (partial) result. Safe to call repeatedly while streaming. */
    update(data) {
      const c = Render.ensureCards();
      const gap = data.concept_gap || {};
      if (data.status && STATUS[data.status]) {
        c.status.textContent = STATUS[data.status].label;
        c.status.dataset.status = data.status;
      }
      if (gap.name) typeInto(c.name, gap.name, paintText);
      if (gap.one_line_explanation) typeInto(c.oneLine, gap.one_line_explanation, paintText);
      if (gap.why_it_matters) typeInto(c.why, `Why it matters: ${gap.why_it_matters}`, paintText);

      const teach = data.teach || {};
      if (teach.format || teach.content) {
        c.teach.hidden = false;
        const f = FORMATS[teach.format];
        if (f) {
          c.teachLabel.textContent = f.label;
          c.teachBody.classList.toggle("mono-body", !!f.mono);
        }
        if (teach.content) typeInto(c.teachBody, teach.content, (node, text) => richText(node, text, teach.format));
      }
      if (data.try_next) {
        c.tryCard.hidden = false;
        typeInto(c.tryText, data.try_next, paintText);
      }
      if (data.check_question) {
        c.check.hidden = false;
        c.checkText.textContent = data.check_question;
      }
      const more = data.more || {};
      const rows = [
        ["Complexity", more.complexity],
        ["Edge case", more.edge_case],
        ["Related idea", more.related_concept],
      ].filter(([, v]) => v);
      if (rows.length) {
        c.more.hidden = false;
        c.moreList.replaceChildren(...rows.flatMap(([k, v]) => [el("dt", null, k), inline(el("dd"), v)]));
      }
    },

    finish(data, { onTry, onBigger, onCopy, onClear, level, cached }) {
      Render.update(data);
      flushTyping();
      Render.root.setAttribute("aria-busy", "false");
      const c = Render.cards;
      if (data.teach && data.teach.format === "question_ladder") Render.ladder(c.teachBody);

      c.tryBox.addEventListener("change", () => c.tryBox.checked && onTry && onTry());

      c.actions.hidden = false;
      c.actions.replaceChildren();
      const bigger = el("button", "btn btn-soft", level >= 3 ? "Already at the most detailed hint" : "Give me a bigger hint");
      bigger.disabled = level >= 3;
      bigger.addEventListener("click", onBigger);
      const copy = el("button", "btn btn-ghost", "Copy");
      copy.addEventListener("click", onCopy);
      const clear = el("button", "link-btn", "Clear");
      clear.addEventListener("click", onClear);
      c.actions.append(bigger, copy, clear);
      if (cached) c.actions.append(el("span", "muted tiny", "Same input as before: showing your last answer."));
      if (data.guarded) c.actions.append(el("span", "muted tiny", "Some code was removed so the solution isn't given away."));
    },

    // Question ladder: one rung at a time.
    ladder(body) {
      const items = [...body.querySelectorAll("ol > li")];
      if (items.length < 2) return;
      items.slice(1).forEach((li) => (li.hidden = true));
      const next = el("button", "link-btn", "Next question →");
      next.addEventListener("click", () => {
        const hidden = items.find((li) => li.hidden);
        if (hidden) hidden.hidden = false;
        if (!items.some((li) => li.hidden)) next.remove();
      });
      body.append(next);
    },

    resetting() {
      typed.clear();
      Render.cards = null;
      Render.skeleton("Rewording that so it doesn't give away code…");
    },

    error({ message, retryable }, onRetry) {
      Render.clear();
      const card = el("div", "card error-card slide-in");
      card.setAttribute("role", "alert");
      card.append(el("strong", null, "Couldn't get guidance"), el("p", null, message));
      if (retryable !== false) {
        const retry = el("button", "btn btn-primary", "Retry");
        retry.addEventListener("click", onRetry);
        card.append(retry);
      }
      Render.root.append(card);
    },

    notice(message, actionLabel, onAction) {
      const card = el("div", "card notice slide-in");
      card.append(el("p", null, message));
      if (actionLabel) {
        const b = el("button", "btn btn-soft", actionLabel);
        b.addEventListener("click", onAction);
        card.append(b);
      }
      Render.root.prepend(card);
    },

    asText(data) {
      const f = FORMATS[(data.teach || {}).format];
      const more = data.more || {};
      return [
        `Concept gap: ${data.concept_gap.name}`,
        data.concept_gap.one_line_explanation,
        `Why it matters: ${data.concept_gap.why_it_matters}`,
        "",
        `${f ? f.label : "Learn it"}:`,
        data.teach.content,
        "",
        `Try this next: ${data.try_next}`,
        `Check yourself: ${data.check_question}`,
        ...(more.complexity ? [`Complexity: ${more.complexity}`] : []),
        ...(more.edge_case ? [`Edge case: ${more.edge_case}`] : []),
        ...(more.related_concept ? [`Related idea: ${more.related_concept}`] : []),
      ].join("\n");
    },
  };

  globalThis.Render = Render;
})();
