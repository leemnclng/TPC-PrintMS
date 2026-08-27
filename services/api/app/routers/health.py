from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.config import settings
from ..db.session import get_db
from ..schemas.health import HealthRead

router = APIRouter(tags=["health"])
_started_at = time.monotonic()


@router.get("/health", response_model=HealthRead)
def health(db: Session = Depends(get_db)) -> HealthRead:
    # Intentionally unauthenticated: this is the one endpoint the sidebar's
    # connection indicator polls before it has anything to show the user,
    # and it leaks nothing beyond "a local backend is up."
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    return HealthRead(
        stage=settings.stage,
        version=settings.version,
        uptime_seconds=time.monotonic() - _started_at,
        db_ok=db_ok,
        data_dir=str(settings.resolved_data_dir),
        database_path=str(settings.resolved_database_path),
        database_paths={stage: str(path) for stage, path in settings.resolved_database_paths.items()},
        database_path_sources=settings.database_path_sources,
    )
