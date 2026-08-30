from __future__ import annotations

import shutil
import sqlite3
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.security import require_token
from ..db.models import BusinessProfile
from ..db.session import get_db
from ..schemas.settings import BusinessProfileRead, BusinessProfileUpdate, RestoreResultRead, StorageStatusRead
from ..services.backup_restore import (
    BackupValidationError,
    create_backup,
    restore_backup,
    storage_status,
    write_environment_config,
)

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_token)])


def _get_or_create(db: Session) -> BusinessProfile:
    profile = db.query(BusinessProfile).first()
    if not profile:
        # Should already exist from app.seed at startup; this is a defensive
        # fallback only.
        profile = BusinessProfile(business_name="Untitled Business")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/business-profile", response_model=BusinessProfileRead)
def get_business_profile(db: Session = Depends(get_db)) -> BusinessProfile:
    return _get_or_create(db)


@router.put("/business-profile", response_model=BusinessProfileRead)
def update_business_profile(payload: BusinessProfileUpdate, db: Session = Depends(get_db)) -> BusinessProfile:
    profile = _get_or_create(db)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    write_environment_config(profile)
    return profile


@router.get("/storage", response_model=StorageStatusRead)
def get_storage_status() -> dict:
    return storage_status()


@router.get("/backup")
def download_backup() -> FileResponse:
    try:
        archive = create_backup()
    except (OSError, sqlite3.DatabaseError) as error:
        raise HTTPException(status_code=500, detail="The backup could not be created in the environment folder.") from error
    return FileResponse(archive, media_type="application/zip", filename=archive.name)


@router.post("/restore", response_model=RestoreResultRead)
def restore_environment_backup(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=415, detail="Choose a Printing-MS .zip backup.")
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="printing-ms-restore-",
            suffix=".zip",
            dir=settings.resolved_data_dir,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            shutil.copyfileobj(file.file, temporary)
        return restore_backup(temporary_path)
    except BackupValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (OSError, sqlite3.DatabaseError) as error:
        raise HTTPException(status_code=500, detail="The backup could not be restored safely.") from error
    finally:
        file.file.close()
        if temporary_path:
            temporary_path.unlink(missing_ok=True)
