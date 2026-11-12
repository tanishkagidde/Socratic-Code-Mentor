# Changelog

## 2.0.0

### Speed
- New `POST /mentor/stream` (Server-Sent Events). The concept gap streams first; `/mentor` stays as a fallback.
- One `genai.Client` is reused across requests. Thinking is set to `minimal`, `max_output_tokens` is 700 (was 1200), and automatic function calling is off.
- Default model is `gemini-3.5-flash`, with a fallback list. `gemini-3.8-flash` *is* a valid model name, but in testing it often returned 503 "high demand" or hung for 30 s, which caused the old 502s. A busy model now gets 8 s to start answering before the next one is tried.
- Panel:
  - an instant loading skeleton
  - a request that is still running is cancelled when you click again, the code changes, or the problem changes
  - an answer cache keyed by a hash of problem, code, language and level
  - an early `/health` ping
  - error cards with Retry

### Guidance quality
- The new schema is built around the concept gap: `concept_gap`, `teach{format, content}`, `try_next`, `check_question`, and an optional `more`.
- Six teaching formats; the model rotates them and avoids recently taught gaps (only gap names and formats are sent).
- Word limits are enforced in the prompt, as schema `maxLength`, and by a server-side clamp.
- Server-side spoiler guard: every streamed partial is checked; the answer is regenerated once, then scrubbed.
- User content is wrapped in `<problem>` / `<student_code>` tags, and closing tags inside it are escaped.

### Works on any website
- **Bug fix:** editor APIs are now read from the page's main world (`bridge-main.js`). Before, the isolated content script never saw `window.monaco` etc., and Monaco virtualisation cut off scrolled-out code.
- Site adapters for 10 sites, plus a generic detector:
  - editor candidates are scored
  - the problem statement is found with readability-style scoring
  - shadow roots and all frames are searched, with the best result merged across frames
  - the current text selection is used as a fallback
- On-demand injection with `activeTab` + `scripting`, and per-site optional permissions. The static `content_scripts` and the `tabs` permission are gone. Tabs opened before install now work.
- Each result carries a confidence value, and the UI says when it isn't sure.

### Auto-sync
- Live editor change events, plus input events and MutationObservers, are debounced to about 350 ms. No polling.
- The panel follows tab switches, full page loads and SPA navigation. A new problem resets the guidance.
- Manual edits pause sync per field, with **Resume sync**.
- **Auto-hint when I pause typing** is optional and off by default.

### Language detection
- Detection order: editor API mode, then page language picker, then URL, then a heuristic on the code.
- **Bug fix:** word-boundary matching. "Go" no longer matches "django" or "algorithm", and C++, C#, C, Java and JavaScript are told apart.
- The dropdown has **Auto (detected: X)** plus 16 languages. A manual override is remembered.

### UI
- Redesigned with light and dark themes (follows the system, with a toggle), led by a Concept Gap card.
- Cards:
  - a Teach card with a format badge
  - a "Try this next" checkbox
  - a check question revealed on click
  - a "Show more" section
- Mascot moods, XP, a daily streak, a concepts-learned collection, and confetti when the code looks complete.
- A **Give me a bigger hint** button and a segmented hint-depth control.
- Accessibility:
  - honours reduced-motion settings
  - visible focus states and keyboard support
  - one `aria-live` announcement per answer instead of one per chunk

### Repo and backend hygiene
- Resolved the README merge-conflict markers and rewrote the README.
- Added `backend/.env.example`, `requirements-dev.txt` and pinned version ranges.
- CORS is limited to `chrome-extension://` origins (configurable), with a per-IP rate limit, a 64 KB body limit and request timeouts.
- Distinct error codes: missing key, bad key, bad model, quota, overloaded, timeout.
- No user content is logged. The version string is defined once.
- The API URL is configurable in the panel. The confusing import status logic is gone.
- Tests:
  - 26 pytest tests (Gemini mocked)
  - 19 Node tests for language detection and code scoring
  - HTML fixtures for a textarea site, shadow DOM, and real Monaco, CodeMirror and Ace editors

### UI refresh: "clean blocky" design
- New look in light and dark:
  - square blocks with thick outlines and hard shadows
  - a pixel-art owl with mood animations
  - a pixel heading font (Pixelify Sans) and the readable Atkinson Hyperlegible for body text
- Plain labels: **Get hint**, **Hint level: Basic / More / Detailed**, **Worked example / Analogy / …**, **Try this next**, **Concepts learned**.
- Emoji icons are replaced with pixel icons. The header shows a day streak, XP and a 10-block XP bar.
- Concepts learned are block cards: grey (seen once), gold (seen 2–3 times), teal (mastered, 4+).
- Fonts are bundled in `extension/fonts/` (64 KB, SIL OFL). No remote assets.
- `extension/tests/preview.html` renders the panel with mock guidance for design work, with no Gemini calls.
