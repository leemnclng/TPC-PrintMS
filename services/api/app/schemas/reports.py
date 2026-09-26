from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from .common import CamelModel, PageRead


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


class DiscountedJobOrderRead(CamelModel):
    id: str
    number: str
    name: str
    customer_name: str | None
    status: str
    created_at: datetime
    subtotal: float
    discount_name: str
    discount_calculation_type: str
    discount_value: float
    discount_amount: float
    total: float


class DiscountedJobOrderPageRead(PageRead[DiscountedJobOrderRead]):
    subtotal_amount: float
    total_discount_amount: float
    final_amount: float


FailureFaultType = Literal["machine", "material", "operator", "customer"]


class FailureReasonRead(CamelModel):
    code: str
    label: str
    fault_type: FailureFaultType
    is_active: bool
    is_system: bool
    sort_order: int


class FailureReasonCreate(CamelModel):
    code: str
    label: str
    fault_type: FailureFaultType
    is_active: bool = True


class FailureReasonUpdate(CamelModel):
    label: str
    fault_type: FailureFaultType
    is_active: bool = True


class ReportBreakdownRead(CamelModel):
    key: str
    label: str
    count: int
    spoiled_sheets: int = 0
    material_cost: float = 0


class ReconciliationRowRead(CamelModel):
    id: str
    kind: Literal["unconfirmed", "mismatch", "leakage", "linked_external"]
    printer_name: str | None
    document_name: str | None
    expected_pages: int | None
    pages_printed: int | None
    job_order_id: str | None
    observed_print_job_id: str | None


class ReconciliationReportRead(CamelModel):
    generated_at: datetime
    spooler_available: bool
    billed_prints: int
    spooler_confirmed: int
    unconfirmed: int
    page_mismatches: int
    leakage_count: int
    leakage_pages: int
    leakage_estimate: float
    linked_external_prints: int
    rows: list[ReconciliationRowRead]


class FailureReportRead(CamelModel):
    generated_at: datetime
    total_failures: int
    spoiled_sheets: int
    material_cost: float
    failure_rate: float
    by_source: list[ReportBreakdownRead]
    by_reason: list[ReportBreakdownRead]
    by_fault_type: list[ReportBreakdownRead]
    by_product: list[ReportBreakdownRead]
    by_printer: list[ReportBreakdownRead]


class PrinterReliabilityRead(CamelModel):
    printer_name: str
    jobs: int
    pages: int
    failures: int
    error_rate: float
    color_jobs: int
    grayscale_jobs: int
    duplex_jobs: int
    failures_by_source: list[ReportBreakdownRead]


class PrinterReliabilityReportRead(CamelModel):
    generated_at: datetime
    spooler_available: bool
    printers: list[PrinterReliabilityRead]
