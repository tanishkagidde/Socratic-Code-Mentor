
(() => {
  const clean = (value) =>
    String(value || "")
      .replace(/\u00a0/g, " ")
      .trim();

  function fromMonaco() {
    try {
      const models = window.monaco?.editor?.getModels?.() || [];

      for (const model of models) {
        const value = clean(model?.getValue?.());
        if (value) return value;
      }
    } catch (_) {}

    // Fallback: read the code currently rendered by Monaco.
    const lines = [
      ...document.querySelectorAll(
        ".monaco-editor .view-lines .view-line"
      ),
    ].map((line) => line.innerText || line.textContent || "");

    const rendered = clean(lines.join("\n"));
    return rendered.length > 20 ? rendered : "";
  }

  function getCode() {
    const monacoCode = fromMonaco();
    if (monacoCode) return monacoCode;

    // CodeMirror 5
    try {
      for (const element of document.querySelectorAll(".CodeMirror")) {
        const value = clean(element.CodeMirror?.getValue?.());
        if (value) return value;
      }
    } catch (_) {}

    // CodeMirror 6
    try {
      for (const element of document.querySelectorAll(".cm-editor")) {
        const view = element.cmView?.view || element.cmView;
        const value = clean(view?.state?.doc?.toString?.());
        if (value) return value;
      }
    } catch (_) {}

    const cmRendered = [
      ...document.querySelectorAll(".cm-editor .cm-content"),
    ]
      .map((element) =>
        clean(element.innerText || element.textContent)
      )
      .find((value) => value.length > 20);

    if (cmRendered) return cmRendered;

    // Ace editor
    try {
      for (const element of document.querySelectorAll(".ace_editor")) {
        const value = clean(element.env?.editor?.getValue?.());
        if (value) return value;
      }
    } catch (_) {}

    // Textarea and editable-element fallback.
    const selectors = [
      "textarea",
      '[contenteditable="true"]',
      ".ace_text-input",
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const value = clean(
          "value" in element
            ? element.value
            : element.innerText || element.textContent
        );

        const looksLikeCode =
          value.length > 20 &&
          (
            value.includes("\n") ||
            /[{};]|\b(def|function|class|return|const|let|var|public|int)\b/.test(value)
          );

        if (looksLikeCode) return value;
      }
    }

    return "";
  }

  function getProblem() {
    const selectors = [
      '[data-track-load="description_content"]',
      '[data-testid="question-content"]',
      '[data-cy="question-content"]',
      ".challenge-body-html",
      ".problem-statement",
      '[class*="problem-statement"]',
      "article",
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const value = clean(element.innerText || element.textContent);

        if (value.length > 80) {
          return value.slice(0, 12000);
        }
      }
    }

    const main = document.querySelector("main") || document.body;
    const fallback = clean(main?.innerText);

    return fallback.length > 80 ? fallback.slice(0, 12000) : "";
  }

  function getLanguage() {
    const hints = [
      document.querySelector('[aria-label*="language" i]')
        ?.getAttribute("aria-label"),
      document.querySelector('button[class*="language" i]')
        ?.innerText,
      document.querySelector('[class*="language-selector"]')
        ?.innerText,
    ]
      .filter(Boolean)
      .join(" ");

    const languages = [
      "Python",
      "JavaScript",
      "Java",
      "C++",
      "C#",
      "Go",
      "C",
    ];

    return (
      languages.find((language) =>
        hints.toLowerCase().includes(language.toLowerCase())
      ) || ""
    );
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message?.type !== "SCM_EXTRACT_PAGE") return;

      try {
        sendResponse({
          ok: true,
          url: location.href,
          title: document.title,
          problem: getProblem(),
          code: getCode(),
          language: getLanguage(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || "Could not read this page.",
        });
      }

      return true;
    }
  );
})();
