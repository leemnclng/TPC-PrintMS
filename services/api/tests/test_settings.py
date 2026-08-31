import json
import os
import sqlite3
import time
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.migrations import run_migrations
from app.db.models import BusinessProfile
from app.db.session import get_db
from app.routers import settings as settings_router
from app.services import storage_cleanup
from app.services.backup_restore import (
    BackupValidationError,
    _publish_backup_archive,
    _rename_directory_with_retry,
    _replace_with_retry,
    create_backup,
    environment_summaries,
    restore_backup,
    storage_status,
)


def test_owner_name_can_be_configured(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'settings.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "data_dir", tmp_path / "app-data")

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(settings_router.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    profile = client.get("/settings/business-profile", headers=headers).json()
    profile["ownerName"] = "  Lee Maneclang  "
    updated = client.put("/settings/business-profile", headers=headers, json=profile)

    assert updated.status_code == 200
    assert updated.json()["ownerName"] == "Lee Maneclang"


def _create_restorable_database(path: Path, business_name: str) -> None:
    run_migrations()
    database_engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    database_session = sessionmaker(autocommit=False, autoflush=False, bind=database_engine)
    with database_session() as db:
        db.add(BusinessProfile(business_name=business_name, owner_name="Owner"))
        db.commit()
    database_engine.dispose()


def test_backup_and_restore_keep_database_files_and_config_together(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "development" / "printing-ms.db"
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "database_path", database_path)
    _create_restorable_database(database_path, "Before restore")
    retained_file = settings.resolved_managed_files_dir / "jobs" / "source.pdf"
    retained_file.parent.mkdir(parents=True)
    retained_file.write_bytes(b"original-file")

    archive = create_backup()
    with zipfile.ZipFile(archive) as backup:
        assert {"manifest.json", "config.json", "database.sqlite3", "files/jobs/source.pdf"}.issubset(backup.namelist())
        manifest = json.loads(backup.read("manifest.json"))
        assert manifest["stage"] == "development"
        assert manifest["checksums"]["files/jobs/source.pdf"]

    with sqlite3.connect(database_path) as db:
        db.execute("UPDATE business_profile SET business_name = 'After backup'")
    retained_file.write_bytes(b"changed-file")

    result = restore_backup(archive)
    with sqlite3.connect(database_path) as db:
        restored_name = db.execute("SELECT business_name FROM business_profile").fetchone()[0]

    assert restored_name == "Before restore"
    assert retained_file.read_bytes() == b"original-file"
    assert result["safetyBackupFilename"].startswith("pre-restore-development-")
    assert settings.resolved_environment_config_path.is_file()
    assert storage_status()["backupCount"] == 2


def test_environment_summaries_report_every_stage_without_switching(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    # A real schema isn't needed here — environment_summaries() only checks
    # whether the file exists, not that it's a valid, migrated database.
    for stage in ("development", "production"):
        stage_dir = tmp_path / stage
        stage_dir.mkdir(parents=True)
        (stage_dir / "printing-ms.db").write_bytes(b"")

    summaries = {item["stage"]: item for item in environment_summaries()}

    assert set(summaries) == {"development", "test", "production"}
    assert summaries["development"]["isActive"] is True
    assert summaries["development"]["hasDatabase"] is True
    assert summaries["production"]["isActive"] is False
    assert summaries["production"]["hasDatabase"] is True
    assert summaries["test"]["isActive"] is False
    assert summaries["test"]["hasDatabase"] is False


def test_environments_endpoint_lists_every_stage(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'settings.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path / "app-data")

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(settings_router.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    response = client.get("/settings/environments", headers=headers)

    assert response.status_code == 200
    stages = {item["stage"]: item for item in response.json()}
    assert set(stages) == {"development", "test", "production"}
    assert stages["development"]["isActive"] is True
    assert stages["production"]["isActive"] is False


def test_replace_with_retry_recovers_from_a_transient_lock(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.tmp"
    destination = tmp_path / "destination.json"
    source.write_text("new")
    destination.write_text("old")
    real_replace = os.replace
    calls = {"count": 0}

    def flaky_replace(src, dst):
        calls["count"] += 1
        if calls["count"] < 3:
            raise PermissionError("simulated Windows file lock")
        real_replace(src, dst)

    monkeypatch.setattr("app.services.backup_restore.os.replace", flaky_replace)
    monkeypatch.setattr("app.services.backup_restore.time.sleep", lambda _: None)

    _replace_with_retry(source, destination, attempts=5, delay_seconds=0)

    assert destination.read_text() == "new"
    assert calls["count"] == 3


def test_replace_with_retry_raises_and_retains_source_after_exhausting_attempts(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.tmp"
    destination = tmp_path / "destination.json"
    source.write_text("new")

    def always_locked(src, dst):
        raise PermissionError("simulated persistent Windows file lock")

    monkeypatch.setattr("app.services.backup_restore.os.replace", always_locked)
    monkeypatch.setattr("app.services.backup_restore.time.sleep", lambda _: None)

    with pytest.raises(PermissionError):
        _replace_with_retry(source, destination, attempts=3, delay_seconds=0)
    assert source.exists()


def test_backup_publication_falls_back_to_a_verified_copy_when_rename_is_blocked(tmp_path, monkeypatch) -> None:
    source = tmp_path / "staged.zip"
    destination = tmp_path / "backups" / "published.zip"
    source.write_bytes(b"completed archive")

    monkeypatch.setattr("app.services.backup_restore.os.replace", lambda *_: (_ for _ in ()).throw(PermissionError("locked")))
    monkeypatch.setattr("app.services.backup_restore.time.sleep", lambda _: None)

    _publish_backup_archive(source, destination, attempts=2, delay_seconds=0)

    assert destination.read_bytes() == b"completed archive"
    assert not source.exists()


def test_restore_directory_swap_retries_a_transient_windows_lock(tmp_path, monkeypatch) -> None:
    source = tmp_path / "incoming"
    destination = tmp_path / "files"
    source.mkdir()
    real_rename = Path.rename
    calls = {"count": 0}

    def flaky_rename(path: Path, target: Path):
        calls["count"] += 1
        if calls["count"] < 3:
            raise PermissionError("simulated preview lock")
        return real_rename(path, target)

    monkeypatch.setattr(Path, "rename", flaky_rename)
    monkeypatch.setattr("app.services.backup_restore.time.sleep", lambda _: None)

    _rename_directory_with_retry(source, destination, attempts=4, delay_seconds=0)

    assert destination.is_dir()
    assert calls["count"] == 3


def test_restore_rejects_unsafe_archive_paths(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "stage", "test")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    unsafe_archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(unsafe_archive, "w") as archive:
        archive.writestr("../outside.txt", "must-not-escape")
        archive.writestr("manifest.json", json.dumps({
            "archiveFormat": "printing-ms-backup",
            "formatVersion": 1,
            "stage": "test",
        }))

    with pytest.raises(BackupValidationError, match="unsafe file path"):
        restore_backup(unsafe_archive)
    assert not (tmp_path.parent / "outside.txt").exists()


def test_storage_cleanup_reports_and_removes_only_migrated_legacy_leftovers(tmp_path, monkeypatch) -> None:
    # PACKAGE_ROOT is a fixed constant computed from this source checkout —
    # it can't be reached through settings, so it's patched directly on the
    # module under test rather than left pointed at the real repo's own
    # .data folder (which must never be touched by a test run).
    monkeypatch.setattr(storage_cleanup, "PACKAGE_ROOT", tmp_path)
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    legacy_root = tmp_path

    content = b"A" * 10  # fixed size per file — makes totals easy to check

    # Both real stages have already finished migrating.
    for stage in ("development", "production"):
        stage_dir = legacy_root / stage
        (stage_dir / "files").mkdir(parents=True)
        (stage_dir / "backups").mkdir(parents=True)
        (stage_dir / storage_cleanup._LEGACY_MARKER_NAME).write_text("done")

    # A real, current file the active stage actually owns — must survive.
    current_file = legacy_root / "development" / "files" / "kept.txt"
    current_file.write_bytes(content)

    # Legacy, pre-redesign leftovers directly under the root.
    (legacy_root / "files" / "old-job").mkdir(parents=True)
    (legacy_root / "files" / "old-job" / "document.pdf").write_bytes(content)
    (legacy_root / "printing-ms-dev.db").write_bytes(content)
    (legacy_root / "printing-ms-dev.db.bak-123").write_bytes(content)
    scan_bucket = tmp_path / ".data" / "nonprod" / "scan"
    scan_bucket.mkdir(parents=True)
    (scan_bucket / "old-scan.png").write_bytes(content)

    # An abandoned temp folder, old enough to count as orphaned.
    abandoned = legacy_root / "development" / "tmpabandoned"
    abandoned.mkdir(parents=True)
    (abandoned / "database.sqlite3").write_bytes(content)
    old_time = time.time() - (2 * storage_cleanup._ABANDONED_TEMP_AGE_SECONDS)
    os.utime(abandoned, (old_time, old_time))

    # A temp folder from a backup that's genuinely still running — must survive.
    active = legacy_root / "development" / "tmpactive"
    active.mkdir(parents=True)
    (active / "database.sqlite3").write_bytes(content)

    report = storage_cleanup.storage_cleanup_report()
    by_key = {item["key"]: item for item in report}
    assert set(by_key) == {"legacy_storage", "abandoned_temp"}
    assert by_key["legacy_storage"]["itemCount"] == 4
    assert by_key["legacy_storage"]["sizeBytes"] == 4 * len(content)
    assert by_key["abandoned_temp"]["itemCount"] == 1
    assert by_key["abandoned_temp"]["sizeBytes"] == len(content)

    result = storage_cleanup.run_storage_cleanup()
    assert result["freedBytes"] == 5 * len(content)
    assert {item["key"] for item in result["removed"]} == {"legacy_storage", "abandoned_temp"}

    assert not (legacy_root / "files").exists()
    assert not (legacy_root / "printing-ms-dev.db").exists()
    assert not (legacy_root / "printing-ms-dev.db.bak-123").exists()
    assert not scan_bucket.exists()
    assert not abandoned.exists()
    assert current_file.read_bytes() == content
    assert active.is_dir()
    assert storage_cleanup.storage_cleanup_report() == []


def test_storage_cleanup_skips_legacy_leftovers_until_every_real_stage_has_migrated(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage_cleanup, "PACKAGE_ROOT", tmp_path)
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # development has migrated, but production — which has also been used —
    # has not, so the shared legacy source might still be needed by it.
    (tmp_path / "development").mkdir()
    (tmp_path / "development" / storage_cleanup._LEGACY_MARKER_NAME).write_text("done")
    (tmp_path / "production").mkdir()
    (tmp_path / "files").mkdir()
    (tmp_path / "files" / "still-needed.txt").write_bytes(b"not migrated everywhere yet")

    report = storage_cleanup.storage_cleanup_report()
    assert not any(item["key"] == "legacy_storage" for item in report)


def test_storage_cleanup_endpoints_report_then_remove(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage_cleanup, "PACKAGE_ROOT", tmp_path)
    monkeypatch.setattr(settings, "stage", "development")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "development").mkdir()
    (tmp_path / "development" / storage_cleanup._LEGACY_MARKER_NAME).write_text("done")
    (tmp_path / "files").mkdir()
    (tmp_path / "files" / "old.txt").write_bytes(b"leftover")

    app = FastAPI()
    app.include_router(settings_router.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    listed = client.get("/settings/storage-cleanup", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["key"] == "legacy_storage"
    assert listed.json()[0]["itemCount"] == 1

    cleaned = client.post("/settings/storage-cleanup", headers=headers)
    assert cleaned.status_code == 200
    assert cleaned.json()["freedBytes"] == len(b"leftover")
    assert not (tmp_path / "files").exists()
    assert client.get("/settings/storage-cleanup", headers=headers).json() == []
