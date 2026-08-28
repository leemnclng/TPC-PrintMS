from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .common import CamelModel


class PrintTypeCreate(CamelModel):
    label: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    color_mode: Literal["color", "grayscale"] = "color"
    applies_ink_coverage: bool = True


class PrintTypeUpdate(PrintTypeCreate):
    is_active: bool = True


class PrintTypeRead(PrintTypeUpdate):
    key: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
