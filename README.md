# Printing-MS

The Paper Club's printing-management desktop app — Electron + React/TypeScript
renderer, FastAPI + SQLite backend. See [docs/context](docs/context) for the
full product and engineering history; this file only covers running it.

## Prerequisites

- Node.js 20+ and npm
- [`uv`](https://docs.astral.sh/uv/) for the Python backend (`brew install uv`,
  or see the uv docs for other platforms)
- macOS or Linux for printer detection today — the Print Center reads
  installed printers via CUPS (`lpstat`). Windows detection (`win32print`) is
  a documented stub, not yet implemented (see
  [docs/context/issues-log.md](docs/context/issues-log.md)).

## First run

The easiest way to run Printing-MS is the scripts in [`scripts/`](scripts):
they check for Node.js and `uv`, install `uv` automatically if it's missing,
run `npm install` on first use, then start everything.

- **macOS / Linux:** `./scripts/run.sh`
- **Windows:** double-click `scripts\run.bat`, or run it from a terminal

Both scripts start the Vite renderer, wait for it, then launch Electron —
which itself spawns the FastAPI backend via `uv`. One command, frontend and
backend both running; close the app window (or `Ctrl+C` the terminal) to
stop everything.

If you'd rather run the equivalent commands by hand:

```bash
npm install                 # installs the root + apps/web + apps/desktop workspaces
npm run dev                 # starts the Vite renderer, waits for it, then launches Electron
```

Electron spawns the FastAPI backend itself on launch (via `uv run`, which
resolves its own Python environment on first use — the first launch will be
slower while `uv` fetches the interpreter and dependencies). You do not need
to start the backend separately.

The backend's SQLite database and managed files live in the OS-standard
application-data directory (`~/Library/Application Support/PrintingMS` on
macOS), not inside this repo.

## Project layout

```
apps/
  web/         React + TypeScript renderer (Vite)
  desktop/     Electron main process + preload (backend lifecycle, secure IPC)
services/
  api/         FastAPI backend — SQLAlchemy models, Alembic migrations, routers
docs/
  context/     Living product/engineering notes — read this before changing behavior
```

## Backend on its own

Useful for API iteration without launching Electron:

```bash
cd services/api
uv run python -m app.main   # prints the assigned port + per-launch token, then serves
```

Every route except `/health` requires the printed token as an
`X-Print-MS-Token` header.

## What's implemented vs. planned

This is the Phase 2 "application foundation" scaffold described in
[docs/context/build-plan.md](docs/context/build-plan.md): every primary page
and nested workspace exists and is wired to real (currently empty) data —
nothing is a static mock. Customers and the Product Catalog have full
create/edit/delete. Quotations, Job Orders, and printing submission are
intentionally read-only or disabled with an explicit "Planned · Phase N"
marker, because their business rules (pricing, statuses, file handling) are
still open questions tracked in
[docs/context/issues-log.md](docs/context/issues-log.md).
