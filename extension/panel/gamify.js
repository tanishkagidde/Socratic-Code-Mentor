// XP, daily streak, concept collection, mascot moods and confetti.
// Stored only in chrome.storage.local on this device.
(function () {
  "use strict";

  const XP = { guidance: 5, tried: 10, complete: 25, newConcept: 15 };
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  const yesterday = () => new Date(Date.now() - 864e5).toLocaleDateString("en-CA");

  const Gamify = {
    progress: null,

    async init() {
      Gamify.progress = await Store.progress();
      // A streak survives only if the last active day was today or yesterday.
      const p = Gamify.progress;
      if (p.lastDay && p.lastDay !== today() && p.lastDay !== yesterday()) p.streak = 0;
      Gamify.paint();
    },

    async award(kind, conceptName) {
      const p = Gamify.progress;
      let gained = XP[kind] || 0;
      if (kind === "guidance") {
        if (p.lastDay !== today()) {
          p.streak = p.lastDay === yesterday() ? p.streak + 1 : 1;
          p.lastDay = today();
        }
        if (conceptName) {
          const key = conceptName.trim();
          const known = p.concepts[key];
          if (!known) gained += XP.newConcept;
          p.concepts[key] = { count: (known ? known.count : 0) + 1, first: known ? known.first : today() };
        }
      }
      p.xp += gained;
      await Store.saveProgress(p);
      Gamify.paint(gained);
      return gained;
    },

    async reset() {
      await Store.resetProgress();
      Gamify.progress = await Store.progress();
      Gamify.paint();
    },

    paint(gained = 0) {
      const p = Gamify.progress;
      $("xpCount").textContent = p.xp;
      $("streakCount").textContent = p.streak;
      $("streakChip").title = `${p.streak}-day streak`;
      if (gained) {
        const chip = $("xpChip");
        chip.classList.remove("bump");
        void chip.offsetWidth;
        chip.classList.add("bump");
        chip.title = `+${gained} XP`;
      }
      // XP bar: 10 blocks, one per 10 XP inside the current 100.
      const bar = $("xpBar");
      if (bar) {
        const filled = Math.floor((p.xp % 100) / 10);
        bar.replaceChildren(...Array.from({ length: 10 }, (_, i) => {
          const block = document.createElement("i");
          if (i < filled) block.className = "on";
          return block;
        }));
        bar.parentElement.title = `${p.xp} XP · ${100 - (p.xp % 100)} XP to the next 100`;
      }

      // Concept collection: one block card per concept, coloured by how often it came up.
      const entries = Object.entries(p.concepts).sort((a, b) => b[1].count - a[1].count);
      $("conceptCount").textContent = entries.length;
      const grid = $("badges");
      grid.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Every concept you work on is saved here as a card.";
        grid.append(empty);
        return;
      }
      for (const [name, info] of entries) {
        const tier = info.count >= 4 ? 3 : info.count >= 2 ? 2 : 1;
        const card = document.createElement("div");
        card.className = `concept-card tier-${tier}`;
        card.title = `First seen ${info.first}`;
        const gem = document.createElement("span");
        gem.className = "gem";
        const title = document.createElement("b");
        title.textContent = name;
        const seen = document.createElement("small");
        seen.textContent = tier === 3 ? `Mastered · ${info.count}×` : `Seen ${info.count}×`;
        card.append(gem, title, seen);
        grid.append(card);
      }
    },

    mood(state, line) {
      const m = $("mascot");
      m.className = `mascot ${state}`;
      if (line) $("mascotLine").textContent = line;
    },

    confetti() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const host = $("confetti");
      const colors = ["var(--accent)", "var(--select)", "var(--tier-3)", "var(--flame-1)", "var(--owl-fur)"];
      for (let i = 0; i < 48; i++) {
        const piece = document.createElement("i");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = `${Math.random() * 0.25}s`;
        piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
        host.append(piece);
      }
      setTimeout(() => host.replaceChildren(), 1800);
    },
  };

  globalThis.Gamify = Gamify;
})();
