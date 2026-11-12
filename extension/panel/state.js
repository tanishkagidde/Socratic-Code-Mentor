// Persistent panel state.
//  chrome.storage.local   : settings + progress (survive browser restarts)
//  chrome.storage.session : per-problem history + answer cache (cleared when
//                           the browser closes; never sent anywhere in full)
(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    apiBase: "http://127.0.0.1:8000",
    theme: "system", // system | light | dark
    languageOverride: "auto",
    hintLevel: 1,
    autoGuide: false,
  };
  const DEFAULT_PROGRESS = { xp: 0, streak: 0, lastDay: "", concepts: {} };
  const CACHE_LIMIT = 20;

  // Works in the extension and degrades to memory when opened as a plain page.
  const hasChrome = typeof chrome !== "undefined" && chrome.storage;
  const memory = { local: {}, session: {} };
  const area = (name) =>
    hasChrome && chrome.storage[name]
      ? chrome.storage[name]
      : {
          get: async (k) => ({ [k]: memory[name][k] }),
          set: async (obj) => Object.assign(memory[name], obj),
          remove: async (k) => delete memory[name][k],
        };

  async function read(name, key, fallback) {
    try {
      const got = await area(name).get(key);
      return got[key] === undefined ? structuredClone(fallback) : got[key];
    } catch (_) {
      return structuredClone(fallback);
    }
  }
  const write = (name, key, value) => area(name).set({ [key]: value }).catch(() => {});

  async function hash(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const Store = {
    hash,

    async settings() {
      return { ...DEFAULT_SETTINGS, ...(await read("local", "settings", {})) };
    },
    async saveSettings(patch) {
      const next = { ...(await Store.settings()), ...patch };
      await write("local", "settings", next);
      return next;
    },

    async progress() {
      return { ...DEFAULT_PROGRESS, ...(await read("local", "progress", {})) };
    },
    saveProgress: (p) => write("local", "progress", p),
    resetProgress: () => write("local", "progress", structuredClone(DEFAULT_PROGRESS)),

    // Per-problem history: only gap names + formats, last 3.
    async history(problemKey) {
      const all = await read("session", "history", {});
      return all[problemKey] || [];
    },
    async pushHistory(problemKey, entry) {
      const all = await read("session", "history", {});
      const list = [entry, ...(all[problemKey] || [])].slice(0, 3);
      all[problemKey] = list;
      // Keep the map small.
      const keys = Object.keys(all);
      if (keys.length > 30) delete all[keys[0]];
      await write("session", "history", all);
      return list;
    },
    async clearHistory(problemKey) {
      const all = await read("session", "history", {});
      delete all[problemKey];
      await write("session", "history", all);
    },

    async cacheGet(key) {
      const cache = await read("session", "answers", []);
      const hit = cache.find((e) => e.key === key);
      return hit ? hit.value : null;
    },
    async cacheSet(key, value) {
      const cache = (await read("session", "answers", [])).filter((e) => e.key !== key);
      cache.unshift({ key, value });
      await write("session", "answers", cache.slice(0, CACHE_LIMIT));
    },
  };

  globalThis.Store = Store;
})();
