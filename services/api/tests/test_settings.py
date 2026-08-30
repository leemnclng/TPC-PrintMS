import json
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
from app.services.backup_restore import BackupValidationError, create_backup, restore_backup, storage_status


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
