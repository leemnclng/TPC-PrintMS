#!/usr/bin/env bash
# Runs Printing-MS in dev mode on macOS/Linux: starts the Vite renderer, then
# launches Electron, which itself spawns the FastAPI backend via `uv`.
# One window, frontend + backend both running — nothing else to start by hand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "== Printing-MS — starting dev (frontend + backend) =="
echo

# --- Node.js / npm ---
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v20+) and wasn't found on PATH." >&2
  echo "Install it from https://nodejs.org/ and re-run this script." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required and normally ships with Node.js, but wasn't found on PATH." >&2
  echo "Reinstall Node.js from https://nodejs.org/ and re-run this script." >&2
  exit 1
fi
echo "✓ Node $(node --version), npm $(npm --version)"

# --- uv (manages the Python backend's environment) ---
if ! command -v uv >/dev/null 2>&1; then
  echo "uv (Python package manager for the backend) wasn't found — installing it..."
  if command -v brew >/dev/null 2>&1; then
    brew install uv
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  fi
  if ! command -v uv >/dev/null 2>&1; then
    echo "uv installation didn't finish automatically." >&2
    echo "See https://docs.astral.sh/uv/getting-started/installation/, then re-run this script." >&2
    exit 1
  fi
fi
echo "✓ uv $(uv --version | awk '{print $2}')"

# --- npm workspace dependencies (first run only) ---
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo
  echo "Installing npm dependencies (first run only, this can take a minute)..."
  npm install
fi

echo
echo "Launching Printing-MS — Electron will spawn the FastAPI backend itself."
echo "The first backend start is slower while uv resolves the Python environment."
echo "Close the app window (or press Ctrl+C here) to stop everything."
echo

exec npm run dev
