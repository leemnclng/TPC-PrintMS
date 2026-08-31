from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from ..core.config import settings
from ..db.models import BusinessProfile

ARCHIVE_FORMAT = "printing-ms-backup"
ARCHIVE_VERSION = 1
MAX_ARCHIVE_ENTRIES = 20_000
MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024

logger = logging.getLogger(__name__)
_storage_lock = threading.RLock()


class BackupValidationError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _profile_payload(profile: BusinessProfile | None) -> dict[str, Any] | None:
    if profile is None:
        return None
    return {
        "businessName": profile.business_name,
        "ownerName": profile.owner_name,
        "tagline": profile.tagline,
        "email": profile.email,
        "phone": profile.phone,
        "address": profile.address,
        "quotationPrefix": profile.quotation_prefix,
        "jobOrderPrefix": profile.job_order_prefix,
    }


def _replace_with_retry(source: Path, destination: Path, *, attempts: int = 5, delay_seconds: float = 0.1) -> None:
    """`os.replace()` can raise a transient `PermissionError` on Windows when
    the destination is briefly held open by antivirus scanning or the search
    indexer — POSIX rename has no such restriction, which is why this failure
    shows up only on Windows. A short retry-with-backoff clears it rather
    than treating a passing lock as a real, unrecoverable failure."""
    for attempt in range(attempts):
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            if attempt == attempts - 1:
                source.unlink(missing_ok=True)
                logger.warning("Could not replace %s after %d attempts: %s", destination, attempts, error)
                raise
            time.sleep(delay_seconds * (attempt + 1))


def write_environment_config(profile: BusinessProfile | None) -> Path:
    """Mirror non-secret runtime and owner configuration into the stage folder."""
    path = settings.resolved_environment_config_path
    payload = {
        "formatVersion": 1,
        "stage": settings.stage,
        "appVersion": settings.version,
        "updatedAt": _iso(_now()),
        "storage": {
            "environmentDirectory": str(settings.resolved_data_dir),
            "databasePath": str(settings.resolved_database_path),
            "managedFilesDirectory": str(settings.resolved_managed_files_dir),
            "backupsDirectory": str(settings.resolved_backup_dir),
        },
        "printer": {
            "platform": settings.resolved_printer_platform,
            "configuredAs": settings.printer_platform,
        },
        "businessProfile": _profile_payload(profile),
    }
    temporary = path.with_suffix(".json.tmp")
    # Locked against concurrent writers (e.g. a profile save landing mid-backup)
    # so two callers never race on the same temp file.
    with _storage_lock:
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        _replace_with_retry(temporary, path)
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot_database(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(settings.resolved_database_path) as source, sqlite3.connect(destination) as target:
        source.backup(target)


def _managed_files() -> list[Path]:
    root = settings.resolved_managed_files_dir
    resolved_root = root.resolve()
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and not path.is_symlink() and resolved_root in path.resolve().parents
    )


def create_backup(*, prefix: str = "printing-ms") -> Path:
    with _storage_lock, tempfile.TemporaryDirectory(dir=settings.resolved_data_dir) as temporary_dir:
        temporary_root = Path(temporary_dir)
        database_snapshot = temporary_root / "database.sqlite3"
        _snapshot_database(database_snapshot)

        # The JSON snapshot is refreshed immediately before every archive.
        from ..db.session import SessionLocal

        with SessionLocal() as db:
            try:
                profile = db.query(BusinessProfile).first()
            except Exception:
                # The SQLite snapshot remains authoritative. This fallback is
                # useful during first-run recovery before migrations complete.
                profile = None
            write_environment_config(profile)

        created_at = _now()
        timestamp = created_at.strftime("%Y%m%d-%H%M%S-%f")[:-3]
        filename = f"{prefix}-{settings.stage}-{timestamp}.zip"
        destination = settings.resolved_backup_dir / filename
        staged_archive = temporary_root / filename
        checksums: dict[str, str] = {}

        with zipfile.ZipFile(staged_archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source, archive_name in (
                (database_snapshot, "database.sqlite3"),
                (settings.resolved_environment_config_path, "config.json"),
            ):
                archive.write(source, archive_name)
                checksums[archive_name] = _sha256(source)

            for source in _managed_files():
                relative = source.relative_to(settings.resolved_managed_files_dir).as_posix()
                archive_name = f"files/{relative}"
                archive.write(source, archive_name)
                checksums[archive_name] = _sha256(source)

            manifest = {
                "archiveFormat": ARCHIVE_FORMAT,
                "formatVersion": ARCHIVE_VERSION,
                "stage": settings.stage,
                "createdAt": _iso(created_at),
                "appVersion": settings.version,
                "databaseFile": "database.sqlite3",
                "configFile": "config.json",
                "managedFilesRoot": "files",
                "checksums": checksums,
            }
            archive.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        os.replace(staged_archive, destination)
        return destination


def storage_status() -> dict[str, Any]:
    files = _managed_files()
    backups = sorted(settings.resolved_backup_dir.glob("*.zip"), key=lambda path: path.stat().st_mtime)
    config_path = settings.resolved_environment_config_path
    return {
        "stage": settings.stage,
        "environmentDirectory": str(settings.resolved_data_dir),
        "databasePath": str(settings.resolved_database_path),
        "managedFilesDirectory": str(settings.resolved_managed_files_dir),
        "configPath": str(config_path),
        "backupDirectory": str(settings.resolved_backup_dir),
        "managedFileCount": len(files),
        "managedFileBytes": sum(path.stat().st_size for path in files),
        "backupCount": len(backups),
        "lastBackupAt": _iso(datetime.fromtimestamp(backups[-1].stat().st_mtime, UTC)) if backups else None,
        "configUpdatedAt": _iso(datetime.fromtimestamp(config_path.stat().st_mtime, UTC)) if config_path.exists() else None,
    }


def environment_summaries() -> list[dict[str, Any]]:
    """One entry per managed stage folder — unlike `storage_status()`, which
    only reports the active stage, this covers every stage so the Settings
    environment switcher can show what's in each folder before switching."""
    summaries = []
    for stage, database_path in settings.resolved_database_paths.items():
        data_dir = settings.data_dir_for_stage(stage)
        files_root = data_dir / "files"
        backups_root = data_dir / "backups"
        managed_files = [path for path in files_root.rglob("*") if path.is_file()] if files_root.is_dir() else []
        backups = sorted(backups_root.glob("*.zip"), key=lambda path: path.stat().st_mtime) if backups_root.is_dir() else []
        summaries.append({
            "stage": stage,
            "isActive": stage == settings.stage,
            "environmentDirectory": str(data_dir),
            "databasePath": str(database_path),
            "hasDatabase": database_path.is_file(),
            "managedFileCount": len(managed_files),
            "managedFileBytes": sum(path.stat().st_size for path in managed_files),
            "backupCount": len(backups),
            "lastBackupAt": _iso(datetime.fromtimestamp(backups[-1].stat().st_mtime, UTC)) if backups else None,
        })
    return summaries


def _validate_member(info: zipfile.ZipInfo) -> None:
    path = PurePosixPath(info.filename)
    if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
        raise BackupValidationError("The backup contains an unsafe file path.")
    mode = info.external_attr >> 16
    if mode and (mode & 0o170000) == 0o120000:
        raise BackupValidationError("Symbolic links are not allowed in a backup.")


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    if len(archive.infolist()) > MAX_ARCHIVE_ENTRIES:
        raise BackupValidationError("The backup contains too many files.")
    if sum(info.file_size for info in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
        raise BackupValidationError("The expanded backup is too large.")
    for info in archive.infolist():
        _validate_member(info)
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise BackupValidationError("The backup contains duplicate file entries.")
    try:
        manifest = json.loads(archive.read("manifest.json"))
    except (KeyError, json.JSONDecodeError) as error:
        raise BackupValidationError("This is not a valid Printing-MS backup.") from error
    if manifest.get("archiveFormat") != ARCHIVE_FORMAT or manifest.get("formatVersion") != ARCHIVE_VERSION:
        raise BackupValidationError("This backup format is not supported by this app version.")
    if manifest.get("stage") != settings.stage:
        raise BackupValidationError(
            f"This is a {manifest.get('stage', 'different-stage')} backup. Switch to {manifest.get('stage', 'that')} before restoring it."
        )
    required = {"database.sqlite3", "config.json"}
    if not required.issubset(archive.namelist()):
        raise BackupValidationError("The backup is missing its database or configuration snapshot.")
    return manifest


def _extract_and_verify(archive: zipfile.ZipFile, manifest: dict[str, Any], destination: Path) -> None:
    checksums = manifest.get("checksums")
    if not isinstance(checksums, dict):
        raise BackupValidationError("The backup has no integrity checksums.")
    for name, expected in checksums.items():
        if name not in archive.namelist() or not isinstance(expected, str):
            raise BackupValidationError("The backup manifest does not match its contents.")
        target = destination / PurePosixPath(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(name) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
        if _sha256(target) != expected:
            raise BackupValidationError(f"Integrity validation failed for {name}.")


def _validate_database(path: Path) -> None:
    try:
        with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
            integrity = db.execute("PRAGMA integrity_check").fetchone()
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.DatabaseError as error:
        raise BackupValidationError("The backup database cannot be opened.") from error
    if not integrity or integrity[0] != "ok" or not {"alembic_version", "business_profile"}.issubset(tables):
        raise BackupValidationError("The backup database failed its integrity or schema check.")


def restore_backup(archive_path: Path) -> dict[str, Any]:
    with _storage_lock, tempfile.TemporaryDirectory(dir=settings.resolved_data_dir) as temporary_dir:
        temporary_root = Path(temporary_dir)
        try:
            with zipfile.ZipFile(archive_path) as archive:
                manifest = _read_manifest(archive)
                _extract_and_verify(archive, manifest, temporary_root)
        except zipfile.BadZipFile as error:
            raise BackupValidationError("This file is not a readable ZIP backup.") from error

        restored_database = temporary_root / "database.sqlite3"
        _validate_database(restored_database)
        try:
            restored_config = json.loads((temporary_root / "config.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BackupValidationError("The configuration snapshot is invalid.") from error
        if restored_config.get("stage") != settings.stage:
            raise BackupValidationError("The configuration snapshot belongs to another environment.")

        safety_backup = create_backup(prefix="pre-restore")
        incoming_files = temporary_root / "files"
        staged_files = settings.resolved_data_dir / ".restore-incoming"
        previous_files = settings.resolved_data_dir / ".restore-previous"
        shutil.rmtree(staged_files, ignore_errors=True)
        shutil.rmtree(previous_files, ignore_errors=True)
        if incoming_files.exists():
            shutil.copytree(incoming_files, staged_files)
        else:
            staged_files.mkdir(parents=True)

        from ..db.session import SessionLocal, engine

        files_swapped = False
        previous_files_moved = False
        try:
            if settings.resolved_managed_files_dir.exists():
                settings.resolved_managed_files_dir.rename(previous_files)
                previous_files_moved = True
            staged_files.rename(settings.resolved_managed_files_dir)
            files_swapped = True

            engine.dispose()
            with sqlite3.connect(restored_database) as source, sqlite3.connect(settings.resolved_database_path) as target:
                source.backup(target)
            engine.dispose()
            from ..db.migrations import run_migrations

            run_migrations()
            engine.dispose()
            try:
                with SessionLocal() as db:
                    restored_profile = db.query(BusinessProfile).first()
                    write_environment_config(restored_profile)
            except Exception:
                # A valid archive from an older compatible schema can still be
                # restored; startup migrations will refresh this snapshot.
                write_environment_config(None)
        except Exception:
            engine.dispose()
            if files_swapped:
                shutil.rmtree(settings.resolved_managed_files_dir, ignore_errors=True)
            if previous_files_moved and previous_files.exists():
                previous_files.rename(settings.resolved_managed_files_dir)
            try:
                rollback_database = temporary_root / "pre-restore-database.sqlite3"
                with zipfile.ZipFile(safety_backup) as safety_archive, safety_archive.open("database.sqlite3") as source:
                    with rollback_database.open("wb") as output:
                        shutil.copyfileobj(source, output)
                with sqlite3.connect(rollback_database) as source, sqlite3.connect(settings.resolved_database_path) as target:
                    source.backup(target)
                engine.dispose()
            except Exception:
                # Keep the safety ZIP when an exceptional disk/SQLite failure
                # prevents automatic rollback; it remains manually restorable.
                pass
            raise
        finally:
            shutil.rmtree(staged_files, ignore_errors=True)
        shutil.rmtree(previous_files, ignore_errors=True)

        return {
            "stage": settings.stage,
            "restoredAt": _iso(_now()),
            "managedFileCount": len(_managed_files()),
            "safetyBackupFilename": safety_backup.name,
            "message": "Database, managed files, and environment configuration were restored.",
        }
