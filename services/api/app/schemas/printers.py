from __future__ import annotations

from datetime import datetime
from typing import Literal

from .common import CamelModel


class PrinterRead(CamelModel):
    id: str
    system_name: str
    display_name: str
    is_default: bool
    last_seen_state: str
    last_seen_at: datetime


class PrinterPlatformRead(CamelModel):
    platform: Literal["windows", "macos", "linux"]
    configured_platform: Literal["auto", "windows", "macos", "linux"]
    detection_source: Literal["automatic", "environment"]
    adapter: Literal["windows_spooler", "cups"]
