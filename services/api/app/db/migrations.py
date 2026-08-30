from pathlib import Path

from alembic import command
from alembic.config import Config

from ..core.config import settings

PACKAGE_ROOT = Path(__file__).resolve().parents[2]


def run_migrations() -> None:
    cfg = Config(str(PACKAGE_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(PACKAGE_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")
