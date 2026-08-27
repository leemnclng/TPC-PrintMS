from __future__ import annotations

import secrets
import sys
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from .paths import resolve_data_dir

PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PRINT_MS_",
        env_file=PACKAGE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    stage: Literal["development", "production", "test"] = "development"
    host: str = "127.0.0.1"  # loopback only — never 0.0.0.0, per decisions.md
    port: int = 0  # 0 = OS-assigned free port, printed on startup for Electron
    version: str = "0.1.0"
    data_dir: Path | None = None
    # Stage-specific paths keep test/development records isolated from live
    # business data. `database_path` remains as a backwards-compatible,
    # active-stage override for existing installations.
    database_path: Path | None = None
    development_database_path: Path | None = None
    production_database_path: Path | None = None
    test_database_path: Path | None = None
    printer_platform: Literal["auto", "windows", "macos", "linux"] = "auto"

    # Generated fresh per launch. Electron reads it from stdout and hands it
    # to the renderer via the preload bridge; it is never written to disk.
    token: str = secrets.token_urlsafe(32)

    @staticmethod
    def _absolute(path: Path) -> Path:
        path = path.expanduser()
        return path if path.is_absolute() else (PACKAGE_ROOT / path).resolve()

    @property
    def resolved_data_dir(self) -> Path:
        if self.data_dir is not None:
            return resolve_data_dir(self._absolute(self.data_dir))
        return resolve_data_dir()

    @property
    def resolved_database_path(self) -> Path:
        path = self.database_path_for_stage(self.stage)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def database_path_for_stage(self, stage: Literal["development", "production", "test"]) -> Path:
        if self.database_path is not None and stage == self.stage:
            return self._absolute(self.database_path)
        configured_path = {
            "development": self.development_database_path,
            "production": self.production_database_path,
            "test": self.test_database_path,
        }[stage]
        if configured_path is not None:
            return self._absolute(configured_path)
        filename = {
            "development": "printing-ms-dev.db",
            "production": "printing-ms.db",
            "test": "printing-ms-test.db",
        }[stage]
        return self.resolved_data_dir / filename

    @property
    def resolved_database_paths(self) -> dict[str, Path]:
        return {
            stage: self.database_path_for_stage(stage)
            for stage in ("development", "test", "production")
        }

    @property
    def database_path_sources(self) -> dict[str, str]:
        sources: dict[str, str] = {}
        configured = {
            "development": self.development_database_path,
            "production": self.production_database_path,
            "test": self.test_database_path,
        }
        for stage, configured_path in configured.items():
            if self.database_path is not None and stage == self.stage:
                sources[stage] = "PRINT_MS_DATABASE_PATH (legacy active-stage override)"
            elif configured_path is not None:
                sources[stage] = f"PRINT_MS_{stage.upper()}_DATABASE_PATH"
            else:
                sources[stage] = "Managed default"
        return sources

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.resolved_database_path.as_posix()}"

    @property
    def resolved_printer_platform(self) -> Literal["windows", "macos", "linux"]:
        if self.printer_platform != "auto":
            return self.printer_platform
        if sys.platform == "win32":
            return "windows"
        if sys.platform == "darwin":
            return "macos"
        return "linux"

    @property
    def printer_platform_source(self) -> Literal["automatic", "environment"]:
        return "automatic" if self.printer_platform == "auto" else "environment"


settings = Settings()
