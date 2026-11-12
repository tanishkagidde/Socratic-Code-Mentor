// Side panel controller: wires sync -> fields -> request -> cards.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const L = globalThis.SCM.language;

  const ui = {
    problem: $("problem"),
    code: $("code"),
    language: $("language"),
    askBtn: $("askBtn"),
    syncText: $("syncText"),
    syncDot: $("syncDot"),
    siteChip: $("siteChip"),
    permBanner: $("permBanner"),
    permText: $("permText"),
    allowBtn: $("allowBtn"),
    confidenceBanner: $("confidenceBanner"),
    confidenceText: $("confidenceText"),
    announcer: $("announcer"),
  };

  const state = {
    settings: null,
    detected: null, // {id,label,source}
    snapshot: null, // last merged page snapshot
    problemKey: "",
    lastSyncAt: 0,
    paused: { problem: false, code: false },
    controller: null, // AbortController of the in-flight request
    inFlightCode: null,
    result: null,
    level: 1,
    backendOk: null,
    lastAutoAt: 0,
    autoTimer: 0,
  };
  const memCache = new Map();

  // ---------------------------------------------------------------- settings

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function effectiveTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function buildLanguageSelect() {
    ui.language.replaceChildren();
    const auto = new Option(autoLabel(), "auto");
    ui.language.append(auto);
    for (const lang of [...L.LANGUAGES].sort((a, b) => a.label.localeCompare(b.label))) {
      ui.language.append(new Option(lang.label, lang.id));
    }
    ui.language.value = state.settings.languageOverride || "auto";
  }

  function autoLabel() {
    return state.detected ? `Auto (detected: ${state.detected.label})` : "Auto (detecting…)";
  }

  function languageLabel() {
    const v = ui.language.value;
    if (v !== "auto") return L.BY_ID[v] ? L.BY_ID[v].label : v;
    if (state.detected) return state.detected.label;
    const guess = L.fromCode(ui.code.value);
    return guess ? L.BY_ID[guess].label : "";
  }

  function setLevel(level, persist = true) {
    state.level = Math.max(1, Math.min(3, level));
    for (const b of document.querySelectorAll("#levelGroup [role=radio]")) {
      const on = Number(b.dataset.level) === state.level;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (persist) Store.saveSettings({ hintLevel: state.level });
  }

  // -------------------------------------------------------------------- sync

  function relTime(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 10) return "just now";
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)} min ago`;
  }

  function paintSync() {
    if (!state.lastSyncAt) return;
    const anyPaused = state.paused.problem || state.paused.code;
    ui.syncDot.dataset.state = anyPaused ? "paused" : "live";
    ui.syncText.textContent = anyPaused ? "Paused for your edits" : `Synced ${relTime(state.lastSyncAt)}`;
    paintField("problem");
    paintField("code");
  }

  function paintField(field) {
    const chip = $(`${field}Sync`);
    chip.replaceChildren();
    if (state.paused[field]) {
      chip.append("Paused · ");
      const resume = document.createElement("button");
      resume.className = "link-btn";
      resume.textContent = "Resume sync";
      resume.addEventListener("click", () => resumeField(field));
      chip.append(resume);
      chip.dataset.state = "paused";
    } else {
      chip.textContent = state.lastSyncAt ? "Synced" : "";
      chip.dataset.state = "live";
    }
  }

  function resumeField(field) {
    state.paused[field] = false;
    if (state.snapshot) applySnapshot(state.snapshot);
    paintSync();
  }

  function onState(s) {
    ui.permBanner.hidden = true;
    ui.allowBtn.hidden = false;
    switch (s.kind) {
      case "connecting":
        ui.syncDot.dataset.state = "connecting";
        ui.syncText.textContent = "Reading the page…";
        break;
      case "connected":
        if (!s.persistent && /^https?:/.test(s.origin || "")) {
          ui.permBanner.hidden = false;
          ui.permText.textContent = "I can read this tab for now. Allow this site to keep syncing after you navigate.";
        }
        break;
      case "needs-permission":
        ui.syncDot.dataset.state = "off";
        ui.syncText.textContent = "Not connected";
        ui.siteChip.textContent = "This site";
        ui.permBanner.hidden = false;
        if (/^https?:/.test(s.origin || "")) {
          ui.permText.textContent = "I can't read this page yet.";
        } else {
          ui.permText.textContent = "Click the Socratic Mentor icon in the toolbar to let me read this tab, then press ↻. Or paste the problem below.";
          ui.allowBtn.hidden = true;
        }
        break;
      case "unsupported":
      case "error":
      case "no-tab":
        ui.syncDot.dataset.state = "off";
        ui.syncText.textContent = s.message || "No readable page in this tab.";
        break;
      case "needs-reload":
        ui.syncDot.dataset.state = "off";
        ui.syncText.textContent = "Extension needs a reload";
        ui.permBanner.hidden = false;
        ui.allowBtn.hidden = true;
        ui.permText.textContent = "Chrome is still using the old version's permissions. Open chrome://extensions, press Reload (↻) on Socratic Code Mentor, then reopen this panel.";
        break;
      case "no-extension":
        ui.syncText.textContent = "Preview mode (not running as an extension).";
        break;
    }
  }

  function onSnapshot(snap) {
    const isNewProblem = state.problemKey && snap.problemKey && snap.problemKey !== state.problemKey;
    if (isNewProblem) newProblem();
    state.problemKey = snap.problemKey || state.problemKey;
    state.snapshot = snap;
    state.lastSyncAt = Date.now();
    applySnapshot(snap);
  }

  function applySnapshot(snap) {
    ui.siteChip.textContent = snap.site || "Page";
    ui.siteChip.title = snap.title || "";

    if (!state.paused.problem && snap.problem && snap.problem !== ui.problem.value) ui.problem.value = snap.problem;

    const codeChanged = !state.paused.code && snap.code !== ui.code.value && (snap.code || snap.codeConfidence > 0);
    if (codeChanged) {
      ui.code.value = snap.code;
      onCodeChanged();
    }

    refreshDetected(snap.language);

    // Confidence messaging.
    const lowProblem = snap.problemConfidence < 0.5 && !state.paused.problem;
    const noCode = !snap.code && !state.paused.code;
    ui.confidenceBanner.hidden = !(lowProblem || noCode);
    if (lowProblem && noCode) ui.confidenceText.textContent = "I couldn't find the problem or an editor here. Select the problem text on the page, or paste both below.";
    else if (lowProblem) ui.confidenceText.textContent = snap.problem ? "I'm not sure I found the problem. Select the text on the page or paste it." : "I couldn't find a problem statement. Select it on the page or paste it.";
    else if (noCode) ui.confidenceText.textContent = "I couldn't find your code editor. Paste your code below (or leave it empty if you haven't started).";
    $("useSelectionBtn").hidden = !lowProblem;

    paintSync();
  }

  // Language: editor/page detection first, else a guess from the code itself.
  function refreshDetected(fromPage) {
    const guessId = fromPage ? null : L.fromCode(ui.code.value);
    const detected = fromPage || (guessId && { id: guessId, label: L.BY_ID[guessId].label, source: "code" });
    if (detected && (!state.detected || detected.id !== state.detected.id)) {
      state.detected = detected;
      ui.language.options[0].textContent = autoLabel();
    }
  }

  function onCodeChanged() {
    // Code moved on while an answer was streaming: it would be stale.
    if (state.controller && state.inFlightCode !== null && state.inFlightCode !== ui.code.value.trim()) {
      state.controller.abort();
      state.controller = null;
      setBusy(false);
      Render.clear();
      Render.notice("Your code changed, so I stopped that answer.", "Get fresh guidance", () => ask());
      Gamify.mood("idle");
    }
    scheduleAutoGuide();
  }

  function newProblem() {
    if (state.controller) state.controller.abort();
    state.controller = null;
    setBusy(false);
    state.result = null;
    state.paused = { problem: false, code: false };
    Render.clear();
    Gamify.mood("idle", "New problem! Let's take a look.");
    announce("New problem detected.");
  }

  // ---------------------------------------------------------------- auto-guide

  function scheduleAutoGuide() {
    clearTimeout(state.autoTimer);
    if (!state.settings.autoGuide) return;
    state.autoTimer = setTimeout(() => {
      const coolDown = Date.now() - state.lastAutoAt < 60000;
      if (coolDown || state.controller || !ui.problem.value.trim()) return;
      state.lastAutoAt = Date.now();
      ask({ auto: true });
    }, 4000);
  }

  // ----------------------------------------------------------------- request

  function setBusy(busy) {
    ui.askBtn.classList.toggle("busy", busy);
    ui.askBtn.querySelector(".btn-label").textContent = busy ? "Thinking… (click to restart)" : "Get hint";
  }

  function announce(text) {
    ui.announcer.textContent = "";
    setTimeout(() => (ui.announcer.textContent = text), 30);
  }

  async function ask({ auto = false } = {}) {
    const problem = ui.problem.value.trim();
    const code = ui.code.value.trim();

    if (problem.length < 5) {
      $("readingDetails").open = true;
      Render.error({ message: "I need the problem statement first. Select it on the page and press “Use my selection”, or paste it into the Problem box.", retryable: false });
      Gamify.mood("confused");
      return;
    }

    const body = { problem, code, language: languageLabel(), hint_level: state.level };
    const key = await Store.hash(body);

    // Same input as before: answer instantly from cache.
    const cached = memCache.get(key) || (await Store.cacheGet(key));
    if (cached) {
      if (state.controller) state.controller.abort();
      state.controller = null;
      setBusy(false);
      showResult(cached, { cached: true });
      return;
    }
    if (auto && state.result && state.result._key === key) return;

    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.inFlightCode = code;

    const history = await Store.history(state.problemKey);
    body.recent_gaps = history.map((h) => h.gap);
    body.recent_formats = history.map((h) => h.format);

    setBusy(true);
    Render.skeleton(auto ? "You paused. Taking a look…" : "Reading your code…");
    Gamify.mood("thinking", "Hmm, let me think…");
    // Gemini latency is spiky: say so instead of showing a silent skeleton.
    let gotText = false;
    const slowNote = setTimeout(() => {
      const note = document.querySelector("#output .thinking");
      if (!gotText && note) note.firstChild.textContent = "Gemini is busy right now, still trying…";
    }, 6000);

    try {
      await Api.stream(body, {
        signal: controller.signal,
        onEvent(type, data) {
          if (state.controller !== controller) return;
          if (type === "partial") {
            gotText = true;
            Render.update(data);
          }
          else if (type === "reset") Render.resetting();
          else if (type === "done") {
            data._key = key;
            memCache.set(key, data);
            Store.cacheSet(key, data);
            Store.pushHistory(state.problemKey, { gap: data.concept_gap.name, format: data.teach.format });
            showResult(data, { cached: false });
          }
        },
      });
    } catch (error) {
      if (error.name === "AbortError" || state.controller !== controller) return;
      Gamify.mood("confused", "Something went wrong on my side.");
      Render.error({ message: error.message, retryable: error.retryable }, () => ask());
      if (error.code === "offline") state.backendOk = false;
    } finally {
      clearTimeout(slowNote);
      if (state.controller === controller) {
        state.controller = null;
        state.inFlightCode = null;
        setBusy(false);
      }
    }
  }

  function showResult(data, { cached }) {
    state.result = data;
    Render.clear();
    Render.finish(data, {
      level: state.level,
      cached,
      onTry: () => {
        Gamify.award("tried");
        Gamify.mood("happy", "Nice! Run it and see what happens.");
      },
      onBigger: () => {
        setLevel(state.level + 1);
        ask();
      },
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(Render.asText(data));
          announce("Copied.");
          Gamify.mood("happy", "Copied to your clipboard.");
        } catch (_) {
          Gamify.mood("confused", "Copy isn't available here.");
        }
      },
      onClear: async () => {
        Render.clear();
        state.result = null;
        await Store.clearHistory(state.problemKey);
        Gamify.mood("idle", "Cleared. Fresh start on this problem.");
      },
    });
    const status = Render.STATUS[data.status] || Render.STATUS.incomplete;
    Gamify.mood(status.mood, status.line);
    announce(`Guidance ready. Concept: ${data.concept_gap.name}.`);
    if (!cached) {
      Gamify.award("guidance", data.concept_gap.name);
      if (data.status === "appears_complete") {
        Gamify.award("complete");
        Gamify.confetti();
      }
    }
  }

  // ------------------------------------------------------------------ backend

  async function checkBackend() {
    try {
      const health = await Api.health();
      state.backendOk = true;
      $("askBtn").title = `Backend ready · ${health.model}`;
      return true;
    } catch (error) {
      state.backendOk = false;
      Render.error({ message: error.message, retryable: true }, async () => {
        Render.clear();
        if (await checkBackend()) Gamify.mood("happy", "Connected. Ready when you are!");
      });
      Gamify.mood("confused", "I can't reach my brain (the backend).");
      return false;
    }
  }

  // -------------------------------------------------------------------- events

  function wireEvents() {
    ui.askBtn.addEventListener("click", () => ask());
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        ask();
      }
    });

    // Typing in a panel box = manual override. Pause sync for that field.
    for (const field of ["problem", "code"]) {
      ui[field].addEventListener("input", () => {
        state.paused[field] = true;
        paintSync();
        if (field === "code") {
          refreshDetected(null);
          scheduleAutoGuide();
        }
      });
    }

    ui.language.addEventListener("change", () => Store.saveSettings({ languageOverride: ui.language.value }));

    const radios = [...document.querySelectorAll("#levelGroup [role=radio]")];
    radios.forEach((b, i) => {
      b.addEventListener("click", () => setLevel(Number(b.dataset.level)));
      b.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = radios[(i + d + radios.length) % radios.length];
        setLevel(Number(next.dataset.level));
        next.focus();
      });
    });

    $("refreshBtn").addEventListener("click", () => {
      state.paused = { problem: false, code: false };
      Sync.rescan();
    });

    ui.allowBtn.addEventListener("click", async () => {
      const ok = await Sync.requestPermission();
      if (!ok) Gamify.mood("confused", "No problem. You can paste the problem instead.");
    });

    $("useSelectionBtn").addEventListener("click", async () => {
      const text = await Sync.selection();
      if (text.length < 20) {
        Gamify.mood("confused", "Select the problem text on the page first, then press this again.");
        return;
      }
      ui.problem.value = text.slice(0, 12000);
      state.paused.problem = true;
      ui.confidenceBanner.hidden = true;
      paintSync();
      Gamify.mood("happy", "Got it. Using your selection.");
    });

    $("pasteBtn").addEventListener("click", () => {
      $("readingDetails").open = true;
      ui.problem.focus();
    });

    $("autoGuide").addEventListener("change", async (e) => {
      state.settings = await Store.saveSettings({ autoGuide: e.target.checked });
    });

    $("themeBtn").addEventListener("click", async () => {
      const next = effectiveTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      state.settings = await Store.saveSettings({ theme: next });
    });

    const dialog = $("settingsDialog");
    $("settingsBtn").addEventListener("click", () => {
      $("apiBase").value = state.settings.apiBase;
      $("themeSelect").value = state.settings.theme;
      dialog.showModal();
    });
    $("saveSettingsBtn").addEventListener("click", async (e) => {
      e.preventDefault();
      let base = $("apiBase").value.trim().replace(/\/+$/, "") || "http://127.0.0.1:8000";
      try {
        const origin = new URL(base).origin;
        // A non-default backend needs host permission for fetch().
        if (typeof chrome !== "undefined" && chrome.permissions && !/^http:\/\/(127\.0\.0\.1|localhost):8000$/.test(origin)) {
          const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
          if (!ok) throw new Error("permission denied");
        }
      } catch (_) {
        $("apiBase").setCustomValidity("Enter a valid URL the extension may access.");
        $("apiBase").reportValidity();
        return;
      }
      $("apiBase").setCustomValidity("");
      state.settings = await Store.saveSettings({ apiBase: base, theme: $("themeSelect").value });
      Api.base = base;
      applyTheme(state.settings.theme);
      dialog.close();
      Render.clear();
      checkBackend();
    });
    $("resetProgressBtn").addEventListener("click", async () => {
      if (confirm("Reset your XP, streak and concept collection?")) await Gamify.reset();
    });

    setInterval(paintSync, 15000);
  }

  // ---------------------------------------------------------------------- boot

  async function boot() {
    state.settings = await Store.settings();
    applyTheme(state.settings.theme);
    Api.base = state.settings.apiBase;
    buildLanguageSelect();
    setLevel(state.settings.hintLevel, false);
    $("autoGuide").checked = !!state.settings.autoGuide;
    Render.init($("output"));
    await Gamify.init();
    wireEvents();
    checkBackend(); // early, so a cold/offline backend is visible right away
    Sync.init({ onSnapshot, onState });
  }

  boot();
})();
