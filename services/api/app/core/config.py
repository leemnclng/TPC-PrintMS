from __future__ import annotations

import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

from .paths import resolve_data_dir

DATA_DIR = resolve_data_dir()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PRINT_MS_")

    host: str = "127.0.0.1"  # loopback only — never 0.0.0.0, per decisions.md
    port: int = 0  # 0 = OS-assigned free port, printed on startup for Electron
    version: str = "0.1.0"

    # Generated fresh per launch. Electron reads it from stdout and hands it
    # to the renderer via the preload bridge; it is never written to disk.
    token: str = secrets.token_urlsafe(32)

    @property
    def database_url(self) -> str:
        return f"sqlite:///{DATA_DIR / 'printing-ms.db'}"


settings = Settings()
