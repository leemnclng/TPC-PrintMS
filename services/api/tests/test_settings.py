import json
import os
import sqlite3
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
