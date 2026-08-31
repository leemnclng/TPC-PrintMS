# Printing-MS

The Paper Club's printing-management desktop app — Electron + React/TypeScript
renderer, FastAPI + SQLite backend. See [docs/context](docs/context) for the
full product and engineering history; this file only covers running it.

## Prerequisites

- Node.js 20+ and npm
- [`uv`](https://docs.astral.sh/uv/) for the Python backend (`brew install uv`,
  or see the uv docs for other platforms)
- An operating-system-installed printer driver. Windows printer discovery uses
  the Windows queue; macOS/Linux discovery uses CUPS.
- Windows direct scanning requires a WIA-compatible scanner driver. The Canon
  workstation required the model-specific IJPAT/full MP/WIA driver package;
  Canon PRINT working alone does not guarantee WIA registration.

See the [Windows installation and hardware setup guide](docs/windows-installation.md)
for Canon network selection, verification, and future installer requirements.

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

**Windows desktop shortcut:** a `.bat` file can't carry a custom icon on its
own, so run this once to add a "Printing-MS" shortcut to the Desktop, using
The Paper Club logo, that launches `scripts\run.bat`:

```
powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1
```

Re-running the command safely replaces the existing shortcut. The shortcut
uses Windows' command processor explicitly, so repository paths containing
spaces work and its terminal closes when the Electron window closes.

This still runs the app from source (it needs Node.js and `uv` on the
machine, same as `run.bat` above) — it's a shortcut to the dev launcher, not
a standalone installer. A fully bundled, no-prerequisites Windows installer
is tracked in [docs/context/issues-log.md](docs/context/issues-log.md)
("Packaged (non-dev) builds cannot start the backend yet.").

If you'd rather run the equivalent commands by hand:

```bash
npm install                 # installs the root + apps/web + apps/desktop workspaces
npm run dev                 # starts the Vite renderer, waits for it, then launches Electron
```

Electron spawns the FastAPI backend itself on launch (via `uv run`, which
resolves its own Python environment on first use — the first launch will be
slower while `uv` fetches the interpreter and dependencies). You do not need
to start the backend separately.

For a manual pip-compatible backend setup, install the pinned runtime and test
dependencies into the project virtual environment:

```powershell
cd services\api
uv venv .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
```

`pyproject.toml` and `uv.lock` remain the dependency sources of truth;
`requirements.txt` is their installation export.

The backend reads its runtime stage and SQLite location from
`services/api/.env`. Start from the checked-in example:

```bash
cp services/api/.env.example services/api/.env
```

`PRINT_MS_STAGE` accepts `development`, `production`, or `test`.
`PRINT_MS_DATA_DIR` is the durable root (the scaffold uses `services/api/.data`).
`PRINT_MS_DEVELOPMENT_DATABASE_PATH`, `PRINT_MS_TEST_DATABASE_PATH`, and
`PRINT_MS_PRODUCTION_DATABASE_PATH` independently select where each stage
creates its SQLite `.db`; relative paths resolve from `services/api`. Changing
only `PRINT_MS_STAGE` and restarting therefore switches data sets without
overwriting another stage. `PRINT_MS_DATABASE_PATH` remains a legacy override
for the active stage. Each stage owns a complete folder containing its database,
`files/`, `backups/`, and non-secret `config.json`. Settings can download a
verified ZIP of that boundary or restore a same-stage ZIP after automatically
creating a pre-restore safety backup. Use a persistent, writable absolute data
root for installed production builds.

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
create/edit/delete. Job Orders support manual creation and priced product
lines; quotation UI has been removed in favor of product-aware Document
Analyzer estimates. Printing submission remains disabled because its hardware
and file-handling rules are still tracked in
[docs/context/issues-log.md](docs/context/issues-log.md).
