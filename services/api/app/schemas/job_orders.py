from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from ..db.models import InventoryPaperSize, JobOrderStatus, PaymentMethod, PrintResult, PrintSides
from .common import CamelModel


class JobOrderMaterialPlanCreate(CamelModel):
    inventory_item_id: str
    planned_quantity: float = Field(gt=0)


class JobOrderItemCreate(CamelModel):
    product_id: str
    variant_label: str | None = None
    pages_per_copy: int = Field(ge=1)
    copies: int = Field(ge=1)
    print_sides: PrintSides = PrintSides.single_sided
    materials: list[JobOrderMaterialPlanCreate] = Field(min_length=1)


class JobOrderCreate(CamelModel):
    customer_id: str | None = None
    due_date: datetime | None = None
    notes: str | None = None
    items: list[JobOrderItemCreate] = Field(min_length=1)


class AnalyzedJobOrderCreate(CamelModel):
    product_id: str
    paper_inventory_item_id: str
    variant_id: str | None = None
    customer_id: str | None = None
    copies: int = Field(ge=1)
    due_date: datetime | None = None
    notes: str | None = None
    price_mode: Literal["suggested", "custom"] = "suggested"
    custom_price: float | None = Field(default=None, ge=0)
    other_materials: list[JobOrderMaterialPlanCreate] = Field(default_factory=list)


class JobOrderMaterialPlanRead(CamelModel):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    inventory_item_unit: str
    quantity_on_hand: float
    planned_quantity: float
    consumed_quantity: float
    paper_size: InventoryPaperSize | None


class JobOrderItemRead(CamelModel):
    id: str
    product_id: str
    product_name: str
    service_name: str
    print_type: str
    print_type_label: str
    print_color_mode: str
    variant_label: str | None
    pages_per_copy: int
    copies: int
    unit_price: float
    line_total: float
    print_sides: PrintSides
    materials: list[JobOrderMaterialPlanRead] = Field(default_factory=list)


class JobFileRead(CamelModel):
    id: str
    original_filename: str
    kind: str
    size_bytes: int
    detected_page_count: int | None
    detected_paper_size: str | None
    detected_orientation: str | None
    detected_color_pages: int | None
    detected_bw_pages: int | None
    estimated_color_coverage_percent: float | None
    estimated_ink_coverage_percent: float | None
    estimated_print_time_seconds: int | None
    analysis_confidence: float | None
    uploaded_at: datetime


class PaymentCreate(CamelModel):
    amount: float = Field(gt=0)
    method: PaymentMethod = PaymentMethod.cash


class PaymentRead(CamelModel):
    id: str
    amount: float
    method: PaymentMethod
    verified: bool
    recorded_at: datetime


class JobOrderTransitionCreate(CamelModel):
    to_status: Literal["queued", "quality_check", "ready", "completed"]
    note: str | None = None


class PrintSubmissionCreate(CamelModel):
    printer_id: str
    job_file_id: str
    # Retained as optional compatibility hints for older clients. The server
    # derives authoritative settings from the analyzed job and product.
    copies: int | None = Field(default=None, ge=1, le=99)
    color_mode: Literal["color", "grayscale"] | None = None
    media_size: Literal["A4", "Letter", "Legal"] | None = None
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    scaling: Literal["fit", "fill", "actual_size"] = "fit"
    quality: Literal["draft", "standard", "high"] = "standard"
    borderless: bool = False
    collate: bool = True


class PrintAttemptRead(CamelModel):
    id: str
    printer_id: str
    printer_name: str
    job_file_id: str | None
    filename: str | None
    copies: int
    color_mode: str
    media_size: str
    orientation: str
    scaling: str
    quality: str
    borderless: bool
    collate: bool
    submitted_at: datetime
    result: PrintResult
    operator: str | None
    external_job_id: str | None
    error_message: str | None


class StatusEventRead(CamelModel):
    id: str
    from_status: str | None
    to_status: str
    note: str | None
    occurred_at: datetime


class JobOrderMaterialUsageEntry(CamelModel):
    material_plan_id: str
    quantity_used: float = Field(gt=0)


class JobOrderMaterialUsageCreate(CamelModel):
    entries: list[JobOrderMaterialUsageEntry] = Field(min_length=1)
    note: str | None = None


class JobOrderRead(CamelModel):
    id: str
    number: str
    customer_id: str | None
    customer_name: str | None
    quotation_id: str | None
    status: JobOrderStatus
    total: float
    suggested_total: float
    price_overridden: bool
    amount_paid: float
    due_date: datetime | None
    notes: str | None
    assigned_printer_id: str | None
    items: list[JobOrderItemRead] = Field(default_factory=list)
    files: list[JobFileRead] = Field(default_factory=list)
    payments: list[PaymentRead] = Field(default_factory=list)
    print_attempts: list[PrintAttemptRead] = Field(default_factory=list)
    status_events: list[StatusEventRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
