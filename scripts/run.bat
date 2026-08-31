@echo off
REM Runs Printing-MS in dev mode on Windows: starts the Vite renderer, then
REM launches Electron, which itself spawns the FastAPI backend via `uv`.
REM One window, frontend + backend both running - nothing else to start by hand.
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."

echo == Printing-MS - starting dev (frontend + backend) ==
echo.

REM --- Node.js / npm ---
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required ^(v20+^) and wasn't found on PATH.
  echo Install it from https://nodejs.org/ and re-run this script.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required and normally ships with Node.js, but wasn't found on PATH.
  echo Reinstall Node.js from https://nodejs.org/ and re-run this script.
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo Node %%v found.
for /f "delims=" %%v in ('npm --version') do echo npm %%v found.

REM --- uv (manages the Python backend's environment) ---
where uv >nul 2>nul
if errorlevel 1 (
  echo.
  echo uv ^(Python package manager for the backend^) wasn't found - installing it...
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install --id=astral-sh.uv -e --source winget
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  )
  where uv >nul 2>nul
  if errorlevel 1 (
    echo.
    echo uv didn't finish installing automatically, or this terminal's PATH is stale.
    echo Try closing and reopening your terminal, then run this script again.
    echo Manual install docs: https://docs.astral.sh/uv/getting-started/installation/
    exit /b 1
  )
)
echo uv found.

REM --- npm workspace dependencies (first run only) ---
if not exist "node_modules" (
  echo.
  echo Installing npm dependencies ^(first run only, this can take a minute^)...
  call npm install
  if errorlevel 1 exit /b 1
)

echo.
echo Launching Printing-MS - Electron will spawn the FastAPI backend itself.
echo Electron will validate the backend environment and repair locked dependencies when needed.
echo Close the app window ^(or press Ctrl+C here^) to stop everything.
echo.

call npm run dev

endlocal
