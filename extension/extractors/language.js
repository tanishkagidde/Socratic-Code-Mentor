// Language detection helpers. Pure functions: no DOM access, so they can be
// unit-tested with Node (see extension/tests/language.test.cjs).
(function (root) {
  "use strict";

  // Order matters: more specific names first so "JavaScript" never matches
  // "Java" and "C++" / "C#" never match "C".
  const LANGUAGES = [
    { id: "typescript", label: "TypeScript", aliases: ["typescript", "ts"] },
    { id: "javascript", label: "JavaScript", aliases: ["javascript", "js", "node.js", "nodejs", "node", "ecmascript"] },
    { id: "cpp", label: "C++", aliases: ["c++", "cpp", "g++", "gnu g++", "clang++", "cxx"] },
    { id: "csharp", label: "C#", aliases: ["c#", "csharp", "c sharp", ".net", "mono c#"] },
    { id: "python", label: "Python", aliases: ["python", "python3", "python2", "pypy", "pypy3", "py", "py3"] },
    { id: "java", label: "Java", aliases: ["java", "openjdk", "jdk"] },
    { id: "kotlin", label: "Kotlin", aliases: ["kotlin", "kt"] },
    { id: "swift", label: "Swift", aliases: ["swift"] },
    { id: "rust", label: "Rust", aliases: ["rust", "rs"] },
    { id: "go", label: "Go", aliases: ["go", "golang"] },
    { id: "ruby", label: "Ruby", aliases: ["ruby", "rb"] },
    { id: "php", label: "PHP", aliases: ["php"] },
    { id: "scala", label: "Scala", aliases: ["scala"] },
    { id: "dart", label: "Dart", aliases: ["dart"] },
    { id: "sql", label: "SQL", aliases: ["sql", "mysql", "postgresql", "postgres", "sqlite", "ms sql server", "oracle sql", "t-sql"] },
    { id: "c", label: "C", aliases: ["c", "gnu c", "gcc", "clang c", "c11", "c99"] },
  ];

  const BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));
  // Too ambiguous to trust when they appear in URLs.
  const URL_UNSAFE = new Set(["c", "go", "ts", "js", "rs", "rb", "kt", "py", "node", "oracle sql"]);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Word-boundary match that treats + and # as part of a word, so "c" does
  // not match inside "c++" and "go" does not match inside "django". Digits
  // may follow ("python3", "c11", "g++17", "java8").
  function aliasRegex(alias) {
    return new RegExp(`(?<![a-z0-9+#.])${escapeRe(alias)}(?![a-z+#])`, "i");
  }
  const ALIAS_RES = LANGUAGES.map((l) => ({ lang: l, res: l.aliases.map((a) => [a, aliasRegex(a)]) }));

  function result(id, source) {
    const lang = BY_ID[id];
    return lang ? { id: lang.id, label: lang.label, source } : null;
  }

  /** Detect a language from a short label like "Python3" or "GNU G++17 7.3.0". */
  function fromLabel(text, { forUrl = false } = {}) {
    const value = String(text || "").toLowerCase().trim();
    if (!value || value.length > 80) return null;
    for (const { lang, res } of ALIAS_RES) {
      for (const [alias, re] of res) {
        if (forUrl && URL_UNSAFE.has(alias)) continue;
        if (re.test(value)) return lang.id;
      }
    }
    return null;
  }

  /** Normalise editor mode ids: Monaco "cpp", Ace "ace/mode/c_cpp", CM "text/x-java". */
  function fromEditorMode(mode) {
    let value = String((mode && (mode.name || mode)) || "").toLowerCase().trim();
    if (!value || value === "plaintext" || value === "text" || value === "null") return null;
    value = value.replace(/^ace\/mode\//, "").replace(/^text\/x-/, "").replace(/^application\//, "");
    const map = {
      c_cpp: "cpp", "c++src": "cpp", "c++": "cpp", csrc: "c", cpp: "cpp", c: "c",
      golang: "go", go: "go", csharp: "csharp", "c#": "csharp", python: "python", python3: "python",
      javascript: "javascript", typescript: "typescript", java: "java", kotlin: "kotlin",
      swift: "swift", rust: "rust", ruby: "ruby", php: "php", scala: "scala", dart: "dart",
      sql: "sql", mysql: "sql", pgsql: "sql", jsx: "javascript", tsx: "typescript",
    };
    return map[value] || fromLabel(value);
  }

  const CODE_SIGNALS = {
    python: [[/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[\w\[\], .]+)?:\s*$/m, 4], [/\bself\b/, 2], [/\belif\b/, 3], [/\b(None|True|False)\b/, 1], [/^\s*(for|while|if)\b[^{;]*:\s*$/m, 2], [/^\s*from\s+\w+(\.\w+)*\s+import\b/m, 3], [/\blen\(/, 1]],
    java: [[/System\.out\.print/, 5], [/\bpublic\s+(static\s+)?(class|void|int|boolean|String)\b/, 2], [/\bString\[\]/, 2], [/^\s*import\s+java\./m, 5], [/\bnew\s+\w+(<.*>)?\(.*\)\s*;/, 1], [/\b(ArrayList|HashMap|HashSet)</, 3]],
    cpp: [[/#include\s*<(iostream|vector|bits\/stdc\+\+\.h|string|map|unordered_map|algorithm)>/, 5], [/\bstd::/, 4], [/using\s+namespace\s+std/, 5], [/\bcout\s*<</, 4], [/\bvector</, 3], [/\bauto\s+\w+\s*=/, 1]],
    c: [[/#include\s*<(stdio|stdlib|string)\.h>/, 5], [/\bprintf\s*\(/, 3], [/\bscanf\s*\(/, 3], [/\bmalloc\s*\(/, 3]],
    csharp: [[/using\s+System\s*;/, 5], [/Console\.Write/, 5], [/^\s*namespace\s+\w+/m, 2], [/\bpublic\s+(override\s+)?[\w<>\[\]]+\s+\w+\s*\(.*\)\s*\{?\s*$/m, 1], [/\b(List|Dictionary)<.*>\s+\w+\s*=\s*new\b/, 3], [/\bstring\[\]/, 2]],
    javascript: [[/\bfunction\b/, 2], [/=>/, 2], [/\b(const|let)\s+\w+\s*=/, 2], [/console\.log/, 4], [/===|!==/, 2], [/\bvar\s+\w+\s*=/, 1]],
    typescript: [[/:\s*(number|string|boolean|void|any)(\[\])?\b/, 4], [/^\s*interface\s+\w+/m, 3], [/\b(const|let)\s+\w+\s*:\s*\w+/, 3], [/\bfunction\s+\w+\(.*:\s*\w+.*\)/, 3]],
    go: [[/^\s*package\s+\w+/m, 5], [/\bfunc\s+(\(.*\)\s*)?\w+\(/, 3], [/:=/, 2], [/\bfmt\./, 4], [/\[\]int\b/, 3]],
    rust: [[/\bfn\s+\w+/, 3], [/\blet\s+mut\b/, 5], [/\b(println!|vec!|impl\b|&mut\b)/, 4], [/\b(i32|i64|usize|Vec<|Option<|String::new)/, 3]],
    kotlin: [[/\bfun\s+\w+\s*\(/, 5], [/\bval\s+\w+/, 2], [/\b(IntArray|mutableListOf|listOf)\b/, 4]],
    swift: [[/\bfunc\s+\w+\s*\(.*:\s*[\[\w]/, 3], [/\b(guard|if)\s+let\b/, 5], [/\bvar\s+\w+\s*:\s*\[?(Int|String)/, 4], [/->\s*\[?(Int|Bool|String)\]?\s*\{/, 3]],
    ruby: [[/^\s*def\s+\w+[?!]?(\(.*\))?\s*$/m, 3], [/^\s*end\s*$/m, 4], [/\.each\s+do\b|\bputs\b|\bnil\b/, 3]],
    php: [[/<\?php/, 8], [/\$\w+\s*=/, 3], [/function\s+\w+\s*\(\s*\$/, 4]],
    sql: [[/\bSELECT\b[\s\S]*\bFROM\b/i, 6], [/\b(INNER|LEFT)\s+JOIN\b/i, 3], [/\bGROUP\s+BY\b/i, 2]],
  };

  /** Guess the language from the code itself. Returns an id or null. */
  function fromCode(code) {
    const text = String(code || "");
    if (text.trim().length < 8) return null;
    const scores = {};
    for (const [id, signals] of Object.entries(CODE_SIGNALS)) {
      scores[id] = signals.reduce((sum, [re, weight]) => sum + (re.test(text) ? weight : 0), 0);
    }
    // TypeScript is a superset of JS: only pick it when TS-only signals fire.
    if (scores.typescript >= 3) scores.typescript += scores.javascript;
    // C++ files often include C headers; prefer C++ when C++ signals exist.
    if (scores.cpp >= 3) scores.c = Math.min(scores.c, scores.cpp - 1);
    // Java and C# share a lot; Kotlin/Swift share func/fun-ish shapes.
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [bestId, best] = ranked[0];
    const second = ranked[1] ? ranked[1][1] : 0;
    return best >= 3 && best > second ? bestId : null;
  }

  /**
   * Combine all sources in priority order:
   * editor API mode > page language selector labels > URL > code heuristic.
   */
  function detect({ editorMode, labels = [], url = "", code = "" } = {}) {
    const fromMode = fromEditorMode(editorMode);
    if (fromMode) return result(fromMode, "editor");
    for (const label of labels) {
      const id = fromLabel(label);
      if (id) return result(id, "page");
    }
    try {
      const u = new URL(url);
      const parts = [...u.pathname.split(/[\/\-_.]+/), ...[...u.searchParams.entries()].filter(([k]) => /lang/i.test(k)).map(([, v]) => v)];
      for (const part of parts) {
        const id = fromLabel(part, { forUrl: true });
        if (id) return result(id, "url");
      }
    } catch (_) {}
    const byCode = fromCode(code);
    return byCode ? result(byCode, "code") : null;
  }

  const api = { LANGUAGES, BY_ID, fromLabel, fromEditorMode, fromCode, detect };
  root.SCM = root.SCM || {};
  root.SCM.language = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
