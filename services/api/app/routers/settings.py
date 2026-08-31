from __future__ import annotations

import logging
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
from ..schemas.settings import (
    BusinessProfileRead,
    BusinessProfileUpdate,
    EnvironmentSummaryRead,
    RestoreResultRead,
    StorageCleanupCandidateRead,
    StorageCleanupRequest,
    StorageCleanupResultRead,
    StorageStatusRead,
)
from ..services.backup_restore import (
    BackupValidationError,
    create_backup,
    environment_summaries,
    restore_backup,
    storage_status,
    write_environment_config,
)
from ..services.storage_cleanup import run_storage_cleanup, storage_cleanup_report

logger = logging.getLogger(__name__)
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
    try:
        write_environment_config(profile)
    except OSError:
        # The profile is already saved in the database, which is the source
        # of truth — this mirror is informational, so a locked/unwritable
        # config.json (see backup_restore._replace_with_retry) shouldn't turn
        # a successful save into a 500.
        logger.warning("Could not refresh the environment config snapshot after a profile update.", exc_info=True)
    return profile


@router.get("/storage", response_model=StorageStatusRead)
def get_storage_status() -> dict:
    return storage_status()


@router.get("/environments", response_model=list[EnvironmentSummaryRead])
def list_environments() -> list[dict]:
    return environment_summaries()


@router.get("/storage-cleanup", response_model=list[StorageCleanupCandidateRead])
def get_storage_cleanup_candidates() -> list[dict]:
    return storage_cleanup_report()


@router.post("/storage-cleanup", response_model=StorageCleanupResultRead)
def clean_up_storage(payload: StorageCleanupRequest | None = None) -> dict:
    keys = set(payload.keys) if payload and payload.keys is not None else None
    return run_storage_cleanup(keys)


@router.get("/backup")
def download_backup() -> FileResponse:
    try:
        archive = create_backup()
    except PermissionError as error:
        logger.exception("Windows denied backup access in %s.", settings.resolved_data_dir)
        raise HTTPException(
            status_code=423,
            detail="Windows is holding the environment folder. Close any open backup ZIP or file preview, then retry.",
        ) from error
    except (OSError, sqlite3.DatabaseError) as error:
        # The user-facing message stays generic on purpose (no raw paths/
        # tracebacks), but the real cause — which specific step and OS error —
        # only exists here. Logging it is what makes this diagnosable instead
        # of a guessing game next time it happens.
        logger.exception("The backup could not be created in %s.", settings.resolved_data_dir)
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
    except PermissionError as error:
        logger.exception("Windows denied restore access in %s.", settings.resolved_data_dir)
        raise HTTPException(
            status_code=423,
            detail="Windows is holding a managed database or document. Close open previews, then retry the restore.",
        ) from error
    except (OSError, sqlite3.DatabaseError) as error:
        logger.exception("The backup could not be restored in %s.", settings.resolved_data_dir)
        raise HTTPException(status_code=500, detail="The backup could not be restored safely.") from error
    finally:
        file.file.close()
        if temporary_path:
            temporary_path.unlink(missing_ok=True)
