"""Reclaims disk space the app itself left behind.

Two kinds of thing qualify, and nothing else:

- Pre-environment-folder-redesign leftovers, once every real stage that ever
  used them has finished migrating away (see ``core.config.
  migrate_legacy_files_if_needed``) — proven by that migration's own marker
  file, not guessed at here.
- Temporary folders orphaned by a backup or restore that never finished
  (e.g. the app was killed mid-operation) — the normal path always cleans
  these up itself; only a killed process leaves one behind.

Never a candidate: the active database, anything a JobFile/scan-output row
points to, or backup archives — those are real, wanted data, not clutter.
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..core.config import PACKAGE_ROOT, settings

# A crashed backup/restore leaves its temp folder behind; a real one never
# takes anywhere near this long, so anything older is safely abandoned.
_ABANDONED_TEMP_AGE_SECONDS = 60 * 60
_REAL_STAGES = ("development", "production")
_LEGACY_MARKER_NAME = ".legacy-storage-migrated-v1"
_LEGACY_DB_NAMES = {
    "development": "printing-ms-dev.db",
    "production": "printing-ms.db",
    "test": "printing-ms-test.db",
}


@dataclass
class CleanupCandidate:
    key: str
    label: str
    description: str
    paths: list[Path]
    item_count: int
    size_bytes: int


def _measure(path: Path) -> tuple[int, int]:
    """(item_count, total_bytes) for one path — itself if a file, its
    contents if a directory."""
    if path.is_file():
        return 1, path.stat().st_size
    item_count = 0
    total_bytes = 0
    for entry in path.rglob("*"):
        if entry.is_file() and not entry.is_symlink():
            item_count += 1
            total_bytes += entry.stat().st_size
    return item_count, total_bytes


def _candidate(key: str, label: str, description: str, paths: list[Path]) -> CleanupCandidate | None:
    existing = [path for path in paths if path.exists()]
    if not existing:
        return None
    item_count = 0
    size_bytes = 0
    for path in existing:
        counted_items, counted_bytes = _measure(path)
        item_count += counted_items
        size_bytes += counted_bytes
    return CleanupCandidate(key=key, label=label, description=description, paths=existing, item_count=item_count, size_bytes=size_bytes)


def _legacy_candidate() -> CleanupCandidate | None:
    legacy_root = settings.resolved_data_root
    # Only once every real stage that has actually been used has finished its
    # own migration — a stage that's never run yet, or hasn't finished, might
    # still need to read from this shared source on its own first startup.
    used_stages = [stage for stage in _REAL_STAGES if (legacy_root / stage).is_dir()]
    if not used_stages:
        return None
    if not all((legacy_root / stage / _LEGACY_MARKER_NAME).is_file() for stage in used_stages):
        return None

    scan_bucket = "prod" if settings.stage == "production" else "nonprod"
    legacy_db_name = _LEGACY_DB_NAMES[settings.stage]
    paths = [
        legacy_root / "files",
        legacy_root / "backups",
        PACKAGE_ROOT / ".data" / scan_bucket / "scan",
        legacy_root / legacy_db_name,
        *legacy_root.glob(f"{legacy_db_name}.bak-*"),
    ]
    return _candidate(
        "legacy_storage",
        "Legacy pre-redesign folders",
        "Left over from before each stage had its own folder. Already copied forward — safe to remove.",
        paths,
    )


def _abandoned_temp_candidate() -> CleanupCandidate | None:
    now = time.time()
    known_names = {".restore-incoming", ".restore-previous"}
    found: list[Path] = []
    for stage in ("development", "test", "production"):
        stage_dir = settings.resolved_data_root / stage
        if not stage_dir.is_dir():
            continue
        for entry in stage_dir.iterdir():
            if not entry.is_dir():
                continue
            if entry.name not in known_names and not entry.name.startswith("tmp"):
                continue
            if now - entry.stat().st_mtime < _ABANDONED_TEMP_AGE_SECONDS:
                continue
            found.append(entry)
    if not found:
        return None
    return _candidate(
        "abandoned_temp",
        "Abandoned temporary folders",
        "Left behind by a backup or restore that didn't finish (e.g. the app closed mid-operation).",
        found,
    )


def storage_cleanup_candidates() -> list[CleanupCandidate]:
    return [candidate for candidate in (_legacy_candidate(), _abandoned_temp_candidate()) if candidate]


def storage_cleanup_report() -> list[dict[str, Any]]:
    return [
        {
            "key": candidate.key,
            "label": candidate.label,
            "description": candidate.description,
            "itemCount": candidate.item_count,
            "sizeBytes": candidate.size_bytes,
        }
        for candidate in storage_cleanup_candidates()
    ]


def run_storage_cleanup(keys: set[str] | None = None) -> dict[str, Any]:
    """Deletes every candidate in `keys` (or all found candidates if None).
    Recomputes candidates fresh rather than trusting a stale report, so
    nothing selected earlier but removed elsewhere in the meantime gets
    double-handled."""
    removed: list[dict[str, Any]] = []
    freed_bytes = 0
    for candidate in storage_cleanup_candidates():
        if keys is not None and candidate.key not in keys:
            continue
        surviving_paths: list[Path] = []
        for path in candidate.paths:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
            if path.exists():
                surviving_paths.append(path)
        if surviving_paths:
            # Something (most likely a file Windows is still holding open)
            # survived — report only what was actually measured as gone
            # afterward, never the whole category, so freed space is never
            # overstated.
            surviving_items = surviving_bytes = 0
            for path in surviving_paths:
                counted_items, counted_bytes = _measure(path)
                surviving_items += counted_items
                surviving_bytes += counted_bytes
            item_count = candidate.item_count - surviving_items
            size_bytes = candidate.size_bytes - surviving_bytes
        else:
            item_count = candidate.item_count
            size_bytes = candidate.size_bytes
        removed.append({"key": candidate.key, "label": candidate.label, "itemCount": item_count, "sizeBytes": size_bytes})
        freed_bytes += size_bytes
    return {"removed": removed, "freedBytes": freed_bytes}
