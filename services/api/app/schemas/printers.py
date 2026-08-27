from __future__ import annotations

from datetime import datetime

from .common import CamelModel


class PrinterRead(CamelModel):
    id: str
    system_name: str
    display_name: str
    is_default: bool
    last_seen_state: str
    last_seen_at: datetime
