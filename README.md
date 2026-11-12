# Socratic Code Mentor

A Chrome side-panel extension that coaches you through DSA problems one
concept at a time. It reads the problem and your code from the page as you
type, finds the **one concept you're missing**, and teaches it in a short,
varied format (analogy, worked example, trace table, counterexample, sketch
or question ladder). It never gives you the solution.

```
extension/  Chrome MV3 side panel (plain JS/HTML/CSS, no build step)
backend/    FastAPI + Gemini, streams guidance over Server-Sent Events
```

## 1. Backend setup

You need Python 3.11+ and a Gemini API key from Google AI Studio.

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env              # macOS/Linux: cp .env.example .env
# edit .env and set GEMINI_API_KEY
python -m uvicorn main:app --port 8000
```

Use `python -m uvicorn`, not plain `uvicorn`. On Windows with Smart App
Control or another app-control policy, the `uvicorn.exe` launcher in the
venv can be blocked ("An Application Control policy has blocked this file").
`python -m` runs the same server without it.

If PowerShell blocks activation, run
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first.

**Next time:** just double-click `start-backend.bat` in the project folder.

Check `http://127.0.0.1:8000/health`. It should show `"status": "ok"` and
`"key_configured": true`.

**Use one virtualenv: `backend/.venv`.** A `.venv` at the repo root is not
used by anything and can be deleted. Both are git-ignored.

### Configuration (`backend/.env`)

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | none | Required. Stays on your machine; never put it in extension files. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Primary model. Fast, with minimal thinking. |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash-lite,gemini-3.8-flash` | Used if the primary fails, or in parallel if it is slow (see `HEDGE_AFTER_S`). |
| `GEMINI_THINKING_LEVEL` | `minimal` | Lower is faster. Steps up automatically if a model rejects the level. |
| `GEMINI_TEMPERATURE` | `0.6` | Some variety between answers. |
| `GEMINI_MAX_OUTPUT_TOKENS` | `700` | The answer is short by design. |
| `ALLOWED_ORIGINS` | empty (any Chrome extension) | Pin to your extension: `chrome-extension://<id>`. |
| `REQUEST_TIMEOUT_S` | `30` | Whole-request timeout. |
| `HEDGE_AFTER_S` | `4` | If a model hasn't started answering by then, the next model is started in parallel and the first to answer wins. |
| `RATE_LIMIT_PER_MIN` | `20` | Per-IP, in memory. |

### API

- `GET /health` returns status, version, configured model, and whether a key is set.
- `POST /mentor/stream` sends SSE events: `meta`, then `partial`* (the growing
  JSON answer), an optional `reset` (when the answer is regenerated), then
  `done` or `error`.
- `POST /mentor` returns the same final answer as one JSON response. This is the fallback.

Errors carry a stable `code` (`missing_key`, `bad_key`, `bad_model`,
`quota`, `overloaded`, `timeout`, `rate_limited`, `bad_request`,
`too_large`, `bad_output`) and a `retryable` flag.

## 2. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Open a coding problem and click the extension icon. The side panel opens
   and starts reading the page.
4. Press **Get hint** (or Ctrl+Enter).

After editing extension files, press **Reload** on `chrome://extensions`.
You don't need to refresh coding tabs, because the panel re-injects its reader.

If the backend runs somewhere other than `127.0.0.1:8000`, set its URL in
the panel's ⚙ Settings. Chrome will ask for permission to reach it.

## 3. How auto-sync works

1. When the panel opens, it injects a small reader into the active tab with
   `chrome.scripting`. No content script is declared in the manifest.
2. **`extractors/bridge-main.js`** runs in the page's *main world*. Content
   scripts live in an isolated world where `window.monaco`,
   `element.CodeMirror` and `element.env.editor` don't exist, so the bridge
   is the only way to reach the real editor APIs. It reads the full text
   (Monaco only renders visible lines), the editor's language, and
   subscribes to change events:
   - Monaco: `onDidChangeModelContent`
   - CodeMirror 5 and Ace: `change`
   - CodeMirror 6: no public post-construction hook, so a MutationObserver is used
   - SPA navigation: `history.pushState`
3. **`content.js`** (isolated world) combines three things:
   - the bridge's editor data
   - a **site adapter** (`extractors/adapters.js`) when one matches
   - the **generic detector** (`extractors/generic.js`) for any other site:
     - editors are scored by size, monospace font, focus and code-likeness
     - the problem is found with a readability-style score that penalises
       nav, footer, ads and comments, and boosts "Problem / Input / Output /
       Constraints / Example" headings
     - it searches open shadow roots and every frame it can access
4. Changes are debounced (~350 ms) and sent to the panel only when something
   actually changed. The panel merges the reports from all frames and keeps
   the best problem and code. There is no polling.
5. Each result carries `problemConfidence` and `codeConfidence`. When
   confidence is low, the panel offers **Use my selection** (the text you
   highlighted on the page) or manual paste.

**Source-of-truth rules:**
- The code box mirrors the page's editor.
- If you type in a panel box, sync pauses *for that box* and shows
  **Paused · Resume sync**. Your edits are never overwritten silently.
- A new problem (URL or title change) clears the old guidance and the
  per-problem history.
- If your code changes while an answer is streaming, that answer is stopped,
  because it would describe old code.

**Auto-hint when I pause typing** is off by default. When on, it asks after
4 s of no typing, at most once a minute, and never for unchanged input.

## 4. Supported sites

Built-in adapters, which auto-sync with no extra click:
- LeetCode (.com/.cn)
- HackerRank
- Codeforces
- CodeChef
- AtCoder
- GeeksforGeeks
- Codewars
- CoderPad
- Programiz
- HackerEarth

**Any other site** works through the generic detector:
- Clicking the toolbar icon lets the panel read that tab once (Chrome's
  `activeTab`).
- Click **Allow on this site** to keep syncing after you navigate. This
  grants that one origin only.

To add an adapter, append an entry to `extractors/adapters.js`, and add the
origin to `host_permissions` in `manifest.json` if it should sync without
the Allow click.

## 5. Privacy and permissions

| Permission | Why |
|---|---|
| `sidePanel` | The UI. |
| `activeTab` | Read the tab you clicked the icon on, once, on any site. |
| `scripting` | Inject the reader on demand, including into tabs opened before install. |
| `storage` | Settings, XP and your concept collection (local), plus per-problem history and an answer cache (session). |
| host permissions | The local backend and the coding sites listed above. |
| optional host permissions | Requested **per site**, only when you click "Allow on this site". |

- **No `<all_urls>` and no `tabs` permission.** The extension does not read
  pages you didn't open it on.
- **Trade-off:** `activeTab` alone can't keep syncing after a tab switch or
  a full navigation. That's why other sites need the one-time Allow.
- Problem text and code go only to your own backend, and from there to
  Gemini. The backend **does not log** problem or code text, only error
  codes, model names and timings.
- Only short labels from earlier answers (gap names and formats) are sent
  back to the model to avoid repetition. The full history is never sent.
- CORS only accepts `chrome-extension://` origins, so websites you visit
  can't call your local backend.

## 6. Design decisions

- **Streaming vs one-shot.** Gemini streams the JSON answer with the concept
  gap first (`propertyOrdering`). The backend parses each partial and sends
  field-level updates, so the hero card fills in while the rest is still
  being generated. The cost is that text appears before the full answer can
  be checked. So the spoiler guard checks *every partial*. If it trips, the
  panel clears the answer and the backend regenerates once with a stricter
  note. If that also leaks code, the code is scrubbed and the answer is
  marked as guarded. `/mentor` stays as a non-streaming fallback.
- **On-demand injection vs `<all_urls>`.** Injecting on demand fixes the old
  "Receiving end does not exist" error for tabs opened before install. It
  also avoids silently reading every page. The cost is one Allow click per
  new site for persistent sync.
- **Spoiler guard.** The guard rejects fenced code, function headers in any
  common language, and 3+ lines of code-shaped statements. Trace tables and
  worked examples (`total = 6`) are deliberately allowed.

## 7. Tests

```powershell
cd backend
pip install -r requirements-dev.txt
pytest -q                                   # schema, streaming, spoiler guard, errors, CORS, rate limit
cd ..
node --test extension/tests/extractors.test.cjs   # language detection + code scoring (Node 18+, no npm)
```

The extension fixtures in `extension/tests/fixtures/` can be opened in Chrome:
- a plain textarea site
- a shadow-DOM editor
- real Monaco, CodeMirror 5 and Ace editors

See [TESTING.md](TESTING.md) for the manual checklist.

## 8. Limitations

- Extraction is best effort. Sites change their DOM, and adapters may need
  updates. The generic detector and Use my selection are the fallback.
- Closed shadow roots and cross-origin iframes without permission can't be read.
- CodeMirror 6 language isn't exposed by its API, so it's detected from the
  page or from the code.
- AI output can still be wrong. The spoiler guard is a heuristic, not a proof.
- The backend is meant for local use. Add authentication before exposing it
  publicly.
- The extension never runs or submits your code.

## 9. Working on the UI without spending Gemini quota

Serve the extension folder and open the preview page. It loads the real panel and fills it with mock guidance:

```powershell
cd extension
python -m http.server 8770
# then open http://localhost:8770/tests/preview.html?theme=light
```

Options: `theme=light|dark`, `state=result|thinking|error`, `w=360` (panel width), `open=1` (expand Concepts learned), `reading=1` (expand the problem and code boxes).
