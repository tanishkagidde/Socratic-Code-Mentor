// Small, optional site adapters. Each one only says WHERE things usually
// are on that site; the generic detector still runs if an adapter misses.
// To add a site: append an entry, and add its origin to manifest.json
// host_permissions if it should auto-sync without an "Allow" click.
(function (root) {
  "use strict";

  const ADAPTERS = [
    {
      name: "LeetCode",
      host: /(^|\.)leetcode\.(com|cn)$/,
      problem: ['[data-track-load="description_content"]', '[data-cy="question-content"]', ".question-content__JfgR", '[class*="question-content"]'],
      title: ['[data-cy="question-title"]', 'div.text-title-large a[href^="/problems/"]', ".text-title-large"],
      // Monaco's model language is used first; these are only a fallback.
      language: ['button[id^="headlessui-popover-button"]', '[data-e2e-locator="console-language-button"]'],
      // /problems/two-sum/description/ and /problems/two-sum/submissions/ are the same problem.
      problemKey: (url) => (url.pathname.match(/\/problems\/[^/]+/) || [url.pathname])[0],
    },
    {
      name: "HackerRank",
      host: /(^|\.)hackerrank\.com$/,
      problem: [".challenge-body-html", ".challenge-problem-statement", ".problem-statement", '[class*="challenge_problem_statement"]'],
      title: [".challenge-name", "h1.page-label", ".ui-icon-label.page-label", 'h1[class*="title"]'],
      language: [".select-language .css-1hwfws3", ".select-language", '[class*="language-select"]'],
      problemKey: (url) => (url.pathname.match(/\/challenges\/[^/]+/) || [url.pathname])[0],
    },
    {
      name: "Codeforces",
      host: /(^|\.)codeforces\.(com|ml|es)$/,
      problem: [".problem-statement"],
      title: [".problem-statement .header .title"],
      language: ['select[name="programTypeId"] option:checked'],
    },
    {
      name: "CodeChef",
      host: /(^|\.)codechef\.com$/,
      problem: ['[class*="problem-statement"]', "#problem-statement", '[class*="_problemBody"]', ".problem-statement"],
      title: ['[class*="_titleStatus"] h1', "h1"],
      language: ['[class*="language-select"]', '[class*="_languageSelect"]', '[id*="language-select"]'],
    },
    {
      name: "AtCoder",
      host: /(^|\.)atcoder\.jp$/,
      problem: ["#task-statement .lang-en", "#task-statement"],
      title: ["span.h2"],
      language: ["#select-lang .select2-selection__rendered", "#select-lang select option:checked", "select[name='data.LanguageId'] option:checked"],
    },
    {
      name: "GeeksforGeeks",
      host: /(^|\.)geeksforgeeks\.org$/,
      problem: ['[class*="problems_problem_content"]', '[class*="problem-statement"]', ".problem-statement", '[class*="problemQuestion"]'],
      title: ['[class*="problems_header_content__title"] h3', '[class*="problem-tab__name"]', "h3"],
      language: ['[class*="problems_language_dropdown"] .divider.text', '[class*="language"] .divider.text', ".ui.dropdown .divider.text"],
    },
    {
      name: "Codewars",
      host: /(^|\.)codewars\.com$/,
      problem: ["#description", '[id="description"]', ".markdown.prose"],
      title: ["h4.ml-2", "h4"],
      language: ["#language_dd dd.is-active", '[data-language].is-active', "#language_dd"],
    },
    {
      name: "CoderPad",
      host: /(^|\.)coderpad\.io$/,
      problem: ['[class*="QuestionDescription"]', '[class*="question-description"]', '[class*="instructions"]', '[data-testid*="instructions"]'],
      title: ['[class*="QuestionTitle"]'],
      language: ['[class*="LanguageSelect"]', '[data-testid*="language"]'],
    },
    {
      name: "Programiz",
      host: /(^|\.)programiz\.(com|pro)$/,
      problem: ['[class*="challenge-description"]', '[class*="problem-statement"]', '[class*="ProblemStatement"]'],
      title: ["h1"],
      language: ['[class*="language-select"]', '[class*="LanguageSelector"]'],
    },
    {
      name: "HackerEarth",
      host: /(^|\.)hackerearth\.com$/,
      problem: [".problem-description", ".starwars-lab .problem-statement"],
      title: [".problem-title", "h1"],
      language: ["select#id_language option:checked", ".language-selector"],
    },
  ];

  function find(hostname) {
    return ADAPTERS.find((a) => a.host.test(hostname)) || null;
  }

  root.SCM = root.SCM || {};
  root.SCM.adapters = { ADAPTERS, find };
})(globalThis);
