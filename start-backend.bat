@echo off
rem Double-click to start the Socratic Code Mentor backend on http://127.0.0.1:8000
rem Uses python -m uvicorn because Windows App Control may block uvicorn.exe.
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Set it up first, see README.md section 1.
  pause
  exit /b 1
)
if not exist ".env" (
  echo backend\.env is missing. Copy .env.example to .env and add your GEMINI_API_KEY.
  pause
  exit /b 1
)
echo Starting backend... keep this window open while you use the extension.
".venv\Scripts\python.exe" -m uvicorn main:app --port 8000
pause
