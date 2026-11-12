# Manual test checklist

Setup: backend running on `127.0.0.1:8000`, extension loaded unpacked, and
the panel open with the toolbar icon. Tick each item.

## Backend
- [ ] `http://127.0.0.1:8000/health` shows `status: ok`, `version: 2.0.0`, the model, and `key_configured: true`.
- [ ] Stop the backend and open the panel. The error card says the backend is unreachable and has **Retry**. Start the backend and press Retry: the panel connects.
- [ ] Set `GEMINI_API_KEY=replace_with_your_key` and restart. The panel says the key is missing (no Retry loop).
- [ ] The backend terminal shows only lines like `/mentor/stream outcome=ok model=… ms=…`, with no problem or code text.

## LeetCode (Monaco)
- [ ] Open any problem. The site chip says **LeetCode** and the status shows **Synced just now**.
- [ ] **View what I'm reading** shows the full problem and **all** of your code, including lines scrolled out of view.
- [ ] Type one character in the LeetCode editor. The panel's code box updates within about 1 s, with no click.
- [ ] Language shows **Auto (detected: …)** and matches LeetCode's language picker. Switch language on LeetCode: the detected label follows.
- [ ] Click **Get hint**. The skeleton appears at once, the Concept Gap card fills in first, and the other cards stream in after it.
- [ ] Click **Get hint** again without changes. The same answer appears instantly, marked as your last answer.
- [ ] Go to a different problem in the same tab. The old guidance clears, and the new problem and code appear.
- [ ] Ask on two different problems. The teach format badge and approach differ.

## HackerRank
- [ ] Open a challenge. The problem and code sync, and edits sync live.
- [ ] Language is detected from the editor or the language dropdown.

## Codeforces (no live editor on the problem page)
- [ ] Open a problem page. The problem is found by the adapter, and the code banner asks you to paste code.
- [ ] Open the submit page: the selected language from the dropdown is detected.

## GeeksforGeeks
- [ ] Open a practice problem. The problem and editor code sync, and the language is detected.

## Any other site (plain textarea)
- [ ] Open `extension/tests/fixtures/plain-textarea.html` (serve it, or open it from disk after enabling "Allow access to file URLs"). Click the toolbar icon.
- [ ] The problem is the "reverse the words" text, without nav, sidebar or comments. The code is the textarea, and the language is Python (from code).
- [ ] Type in the textarea. The panel updates within about 1 s.
- [ ] On a random article page with no problem, the panel says it isn't sure. Select some text, press **Use my selection**, and the problem box fills in.
- [ ] Navigate away and back. A banner offers **Allow on this site**. After allowing, sync continues across navigations.

## Tabs and permissions
- [ ] A tab opened **before** the extension was installed or reloaded still syncs (no "Receiving end does not exist").
- [ ] Switch between two problem tabs. The panel follows the active tab.
- [ ] On `chrome://extensions` the panel says browser pages can't be read.

## Manual overrides
- [ ] Edit the code box in the panel. It shows **Paused · Resume sync**, and page edits no longer overwrite it. **Resume sync** restores the page's code.
- [ ] Pick a language manually, then close and reopen the panel. The override is remembered.
- [ ] Change the hint depth, close and reopen. It's remembered. **Give me a bigger hint** steps Basic → More → Detailed, then disables.

## Fun and accessibility
- [ ] XP increases after guidance, ticking "Try this next" gives more XP, and the streak shows 1 on first use today.
- [ ] Each new concept gap appears in **Concepts learned**.
- [ ] Code that looks complete (status *Looks complete*) shows confetti and a happy mascot.
- [ ] Theme toggle switches light and dark; Settings → "Match system" follows the OS.
- [ ] With the OS set to reduce motion, there is no confetti, typing animation or bouncing.
- [ ] Keyboard only: Tab reaches every control, focus rings are visible, arrow keys move the hint-depth control, and Ctrl+Enter asks.
- [ ] A screen reader announces "Guidance ready. Concept: …" once, not every streamed chunk.
