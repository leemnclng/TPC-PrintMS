import logging
import time
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import settings

logger = logging.getLogger(__name__)
storage_started_at = time.perf_counter()
database_migrated = settings.migrate_legacy_database_if_needed()
files_migrated = settings.migrate_legacy_files_if_needed()
logger.info(
    "startup.phase.complete phase=legacy_storage duration_ms=%.1f database_migrated=%s files_migrated=%d",
    (time.perf_counter() - storage_started_at) * 1000,
    database_migrated,
    files_migrated,
)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
