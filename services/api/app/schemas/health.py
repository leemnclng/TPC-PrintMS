from __future__ import annotations

from .common import CamelModel


class HealthRead(CamelModel):
    status: str = "ok"
    version: str
    uptime_seconds: float
    db_ok: bool
    data_dir: str


class OverviewRead(CamelModel):
    job_orders_by_status: dict[str, int]
    quotations_awaiting_approval: int
    payments_awaiting_verification: int
    upcoming_deadlines: int
    print_queue_depth: int
