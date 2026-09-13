from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from .common import CamelModel


class MaintenanceReminderCreate(CamelModel):
    message: str = Field(min_length=3, max_length=240)
    is_active: bool = True

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3:
            raise ValueError("Enter a reminder with at least 3 characters.")
        return value


class MaintenanceReminderUpdate(MaintenanceReminderCreate):
    pass


class MaintenanceReminderRead(CamelModel):
    id: str
    message: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
