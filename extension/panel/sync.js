// Keeps the panel in sync with the active tab:
//  - injects the extractors on demand (activeTab / host permission)
//  - re-injects after full page loads and on tab switches
//  - merges per-frame snapshots into one "best" view of the page
(function () {
  "use strict";

  const ISOLATED_FILES = ["extractors/language.js", "extractors/adapters.js", "extractors/generic.js", "content.js"];
  const MAIN_FILES = ["extractors/bridge-main.js"];
  const hasChrome = typeof chrome !== "undefined" && chrome.scripting;

  const Sync = {
    tabId: null,
    windowId: null,
    origin: "",
    frames: new Map(),
    onSnapshot: () => {},
    onState: () => {},

    async init({ onSnapshot, onState }) {
      Sync.onSnapshot = onSnapshot;
      Sync.onState = onState;
      if (!hasChrome) {
        // Running as the extension but without the "scripting" permission means
        // Chrome is still using an older manifest: the new files were picked up
        // from disk, but the extension itself was never reloaded.
        const isExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
        return onState({ kind: isExtension ? "needs-reload" : "no-extension" });
      }

      const win = await chrome.windows.getCurrent();
      Sync.windowId = win.id;

      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message && message.type === "SCM_SNAPSHOT" && sender.tab && sender.tab.id === Sync.tabId) {
          Sync.frames.set(sender.frameId || 0, message.data);
          Sync.emit();
        }
      });

      chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
        if (windowId === Sync.windowId) Sync.attach(tabId);
      });

      chrome.tabs.onUpdated.addListener((tabId, info) => {
        if (tabId !== Sync.tabId) return;
        if (info.status === "loading") Sync.frames.clear();
        // Full page load: content scripts died with the old document.
        if (info.status === "complete") Sync.inject();
      });

      // Permission granted from elsewhere (or our own button): try again.
      chrome.permissions.onAdded.addListener(() => Sync.inject());

      const [tab] = await chrome.tabs.query({ active: true, windowId: Sync.windowId });
      if (tab) await Sync.attach(tab.id);
      else onState({ kind: "no-tab" });
    },

    async attach(tabId) {
      if (Sync.tabId !== tabId) Sync.frames.clear();
      Sync.tabId = tabId;
      await Sync.inject();
    },

    async inject() {
      if (!Sync.tabId) return;
      let tab;
      try {
        tab = await chrome.tabs.get(Sync.tabId);
      } catch (_) {
        return Sync.onState({ kind: "no-tab" });
      }
      // tab.url is only visible when we have access; that's fine.
      const url = tab.url || tab.pendingUrl || "";
      if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url) || /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(url)) {
        return Sync.onState({ kind: "unsupported", message: "Browser pages can't be read. Open a coding problem in this tab." });
      }

      Sync.onState({ kind: "connecting" });
      try {
        await Sync.exec(true);
        // Readable now. Is that permanent (host permission) or a one-off
        // activeTab grant that ends when the tab navigates elsewhere?
        Sync.origin = await Sync.tabOrigin();
        let persistent = false;
        try {
          persistent = /^https?:/.test(Sync.origin) && (await chrome.permissions.contains({ origins: [`${Sync.origin}/*`] }));
        } catch (_) {}
        Sync.onState({ kind: "connected", origin: Sync.origin, persistent });
      } catch (error) {
        const msg = String((error && error.message) || error);
        if (/cannot access|missing host permission|permission/i.test(msg)) {
          Sync.origin = await Sync.tabOrigin();
          Sync.onState({ kind: "needs-permission", origin: Sync.origin });
        } else if (/no tab|tab was closed|frame with id 0 was removed|error page/i.test(msg)) {
          Sync.onState({ kind: "unsupported", message: "This tab can't be read right now. Reload it and try again." });
        } else {
          Sync.onState({ kind: "error", message: msg });
        }
      }
    },

    async exec(allFrames) {
      const target = { tabId: Sync.tabId, allFrames };
      try {
        await chrome.scripting.executeScript({ target, world: "MAIN", files: MAIN_FILES });
        await chrome.scripting.executeScript({ target, files: ISOLATED_FILES });
      } catch (error) {
        // Some child frame may be off-limits; the top frame alone still helps.
        if (allFrames) return Sync.exec(false);
        throw error;
      }
    },

    async tabOrigin() {
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: Sync.tabId }, func: () => location.origin });
        return result;
      } catch (_) {
        try {
          const tab = await chrome.tabs.get(Sync.tabId);
          return tab.url ? new URL(tab.url).origin : "";
        } catch (__) {
          return "";
        }
      }
    },

    /** Must be called from a click handler (user gesture). */
    async requestPermission() {
      const origin = Sync.origin;
      // Without any access Chrome doesn't tell us the tab's URL, so there is
      // nothing specific to ask for. The UI tells the user to click the
      // toolbar icon instead (that grants activeTab for this tab).
      if (!/^https?:/.test(origin)) return false;
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (granted) await Sync.inject();
      return granted;
    },

    rescan() {
      if (!Sync.tabId) return;
      Sync.frames.clear();
      Sync.inject();
    },

    /** Longest text selection across frames ("" if none). */
    async selection() {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: Sync.tabId, allFrames: true },
          func: () => String(window.getSelection ? window.getSelection() : "").trim(),
        });
        return results.map((r) => r.result || "").sort((a, b) => b.length - a.length)[0] || "";
      } catch (_) {
        return "";
      }
    },

    /** Merge per-frame reports into the best single view. */
    merged() {
      const reports = [...Sync.frames.entries()].map(([frameId, d]) => ({ frameId, ...d })).filter((d) => !d.error);
      if (!reports.length) return null;
      const top = reports.find((r) => r.frameId === 0) || reports[0];
      const bestProblem = [...reports].sort((a, b) => b.problemConfidence - a.problemConfidence || (a.frameId === 0 ? -1 : 1))[0];
      const bestCode = [...reports].sort((a, b) => b.codeConfidence - a.codeConfidence || (b.code || "").length - (a.code || "").length)[0];
      const language =
        (bestCode.codeConfidence > 0 && bestCode.language) || bestProblem.language || reports.map((r) => r.language).find(Boolean) || null;
      return {
        site: top.site,
        title: top.title,
        url: top.url,
        problemKey: top.problemKey,
        problem: bestProblem.problem || "",
        problemConfidence: bestProblem.problemConfidence || 0,
        problemSource: bestProblem.problemSource,
        code: bestCode.code || "",
        codeConfidence: bestCode.codeConfidence || 0,
        codeSource: bestCode.codeSource,
        language,
        frames: reports.length,
      };
    },

    emit() {
      const merged = Sync.merged();
      if (merged) Sync.onSnapshot(merged);
    },
  };

  globalThis.Sync = Sync;
})();
