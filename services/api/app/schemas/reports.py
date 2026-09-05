from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from .common import CamelModel


ReportPeriod = Literal["daily", "weekly", "monthly", "custom"]
InventoryReportStatus = Literal["healthy", "low", "out"]


class ReportPaymentMethodRead(CamelModel):
    method: str
    amount: float
    payment_count: int


class ReportSalesRead(CamelModel):
    total_sales: float
    transaction_count: int
    verified_payment_count: int
    by_payment_method: list[ReportPaymentMethodRead]


class ReportReattemptProductRead(CamelModel):
    product_id: str
    product_name: str
    re_attempt_count: int
    affected_job_count: int


class ReportReattemptsRead(CamelModel):
    total_re_attempts: int
    affected_job_count: int
    affected_product_count: int
    by_product: list[ReportReattemptProductRead]


class ReportInventoryItemRead(CamelModel):
    id: str
    name: str
    category: str
    unit: str
    quantity_on_hand: float
    reorder_level: float
    paper_size: str | None
    status: InventoryReportStatus


class ReportInventoryRead(CamelModel):
    as_of: datetime
    active_item_count: int
    inactive_item_count: int
    healthy_count: int
    low_stock_count: int
    out_of_stock_count: int
    items: list[ReportInventoryItemRead]


class OperationalReportRead(CamelModel):
    period: ReportPeriod
    period_start: date
    period_end: date
    generated_at: datetime
    sales: ReportSalesRead
    re_attempts: ReportReattemptsRead
    inventory: ReportInventoryRead
