# Socratic Code Mentor — Local MVP

Minimal Chrome side-panel extension for DSA practice on LeetCode and HackerRank. It tries to import visible problem text/editor code; manual paste is the fallback.

## Configure API key
Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY`. Get a key from Google AI Studio. Never place the key in extension files or commit `.env`.

## Windows PowerShell
From project folder:
```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
If activation is blocked, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal and activate again. Or use Command Prompt: `.venv\Scripts\activate.bat`.

## macOS/Linux
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Check `http://127.0.0.1:8000/health` for `{"status":"ok"}`. Keep the backend terminal open.

## Load extension
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and select the `extension` folder.
4. Open a LeetCode or HackerRank problem and click the extension icon.
5. Click Import from page. Check the imported text/code; paste manually if extraction misses anything.
6. Choose a hint level and click Get guidance.

After editing extension files, press Reload on `chrome://extensions` and refresh the coding website.

## Limitations
Extraction is best-effort because platform editors and DOM structures can change. The extension does not run or submit code. AI output can be wrong and prompt rules cannot guarantee it never reveals too much. This backend is for local development only; restrict CORS and add rate limits/authentication before public deployment.
