from __future__ import annotations

from .common import CamelModel


class HealthRead(CamelModel):
    status: str = "ok"
    stage: str
    version: str
    uptime_seconds: float
    db_ok: bool
    data_dir: str
    database_path: str
    database_paths: dict[str, str]
    database_path_sources: dict[str, str]


class OverviewRead(CamelModel):
    job_orders_by_status: dict[str, int]
    quotations_awaiting_approval: int
    payments_awaiting_verification: int
    upcoming_deadlines: int
    print_queue_depth: int
