"""Resolves the managed application-data directory.

Per docs/context/decisions.md, local persistence lives in a managed
application-data directory (not the project folder), so it survives
reinstalls/upgrades and matches normal desktop-app conventions on each OS.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "PrintingMS"


def resolve_data_dir() -> Path:
    override = os.environ.get("PRINT_MS_DATA_DIR")
    if override:
        path = Path(override).expanduser()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA", str(Path.home()))
        path = Path(base) / APP_DIR_NAME
    else:
        base = os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
        path = Path(base) / APP_DIR_NAME

    (path / "files").mkdir(parents=True, exist_ok=True)
    (path / "backups").mkdir(parents=True, exist_ok=True)
    return path
