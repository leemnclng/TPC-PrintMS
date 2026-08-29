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


class ObservedPrintJobRead(CamelModel):
    id: str
    os_job_id: str
    printer_name: str
    document_name: str
    owner: str | None
    driver_name: str | None
    total_pages: int | None
    pages_printed: int | None
    size_bytes: int | None
    status: Literal["queued", "spooling", "printing", "paused", "error", "released"]
    raw_status: str | None
    submitted_at: datetime | None
    first_seen_at: datetime
    last_seen_at: datetime
    released_at: datetime | None
    review_status: Literal["unreviewed", "dismissed", "linked"]
    reviewed_at: datetime | None
    linked_job_order_id: str | None


class SpoolerMonitorRead(CamelModel):
    supported: bool
    active: bool
    message: str
    jobs: list[ObservedPrintJobRead]


class PrintActivityJobRead(CamelModel):
    job_order_id: str
    job_number: str
    job_name: str
    job_status: str
    attempt_id: str | None
    printer_name: str | None
    filename: str | None
    state: Literal[
        "ready",
        "submitted",
        "queued",
        "spooling",
        "printing",
        "paused",
        "error",
        "released",
        "awaiting_reinsert",
        "awaiting_scan",
    ]
    pages_printed: int | None
    total_pages: int | None
    duplex_pass: Literal["simplex", "front", "back"] | None
    submitted_at: datetime | None
    attention_required: bool


class PrintActivityRead(CamelModel):
    jobs: list[PrintActivityJobRead]
