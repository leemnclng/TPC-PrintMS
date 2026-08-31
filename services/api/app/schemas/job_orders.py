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
    materials: list[JobOrderMaterialPlanCreate] = Field(default_factory=list)


class JobOrderCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    customer_id: str | None = None
    due_date: datetime | None = None
    notes: str | None = None
    items: list[JobOrderItemCreate] = Field(min_length=1)


class AnalyzedJobOrderCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100)
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
    observed_print_job_id: str | None = None


class PhotocopyJobOrderCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    service_id: str
    product_id: str
    paper_inventory_item_id: str
    customer_id: str | None = None
    pages_per_copy: int = Field(ge=1, le=100000)
    copies: int = Field(ge=1, le=10000)
    back_to_back: bool = False
    due_date: datetime | None = None
    notes: str | None = None


class ScanJobOrderCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    service_id: str
    product_id: str
    customer_id: str | None = None
    due_date: datetime | None = None
    notes: str | None = None


class TransactionItemCreate(CamelModel):
    client_key: str = Field(min_length=1, max_length=64)
    product_id: str
    paper_inventory_item_id: str | None = None
    variant_id: str | None = None
    pages_per_copy: int = Field(default=1, ge=1, le=100000)
    copies: int = Field(default=1, ge=1, le=10000)
    back_to_back: bool = False
    price_mode: Literal["suggested", "custom"] = "suggested"
    custom_price: float | None = Field(default=None, ge=0)
    other_materials: list[JobOrderMaterialPlanCreate] = Field(default_factory=list)
    # Set when this line records a Windows print already completed outside
    # Printing-MS (e.g. Canon PRINT) — per line, not per transaction, so
    # several already-tracked prints can be recorded together.
    observed_print_job_id: str | None = None


class TransactionCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    initial_service_id: str
    customer_id: str | None = None
    due_date: datetime | None = None
    notes: str | None = None
    items: list[TransactionItemCreate] = Field(min_length=1, max_length=50)


class JobOrderMaterialPlanRead(CamelModel):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    inventory_item_unit: str
    quantity_on_hand: float
    planned_quantity: float
    consumed_quantity: float
    paper_size: InventoryPaperSize | None
    paper_width_mm: float | None
    paper_height_mm: float | None


class JobOrderItemStatusEventRead(CamelModel):
    id: str
    from_status: str | None
    to_status: str
    note: str | None
    occurred_at: datetime


class JobOrderItemRead(CamelModel):
    id: str
    product_id: str
    product_name: str
    service_name: str
    operation_kind: Literal["printing", "photocopy", "scan"]
    status: Literal["queued", "printing", "ready"]
    reprocess_count: int
    print_type: str
    print_type_label: str
    print_color_mode: str
    variant_label: str | None
    pages_per_copy: int
    copies: int
    unit_price: float
    line_total: float
    print_sides: PrintSides
    requires_manual_duplex: bool
    materials: list[JobOrderMaterialPlanRead] = Field(default_factory=list)
    status_events: list[JobOrderItemStatusEventRead] = Field(default_factory=list)


class JobFileRead(CamelModel):
    id: str
    job_order_item_id: str | None
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
    to_status: Literal["queued", "ready", "paid", "completed"]
    note: str | None = None


class JobOrderItemTransitionCreate(CamelModel):
    to_status: Literal["queued", "ready"]
    note: str | None = None


class JobOrderCancelCreate(CamelModel):
    reason: str = Field(min_length=3, max_length=500)


class PrintSubmissionCreate(CamelModel):
    printer_id: str
    job_file_id: str
    job_order_item_id: str | None = None
    # Compatibility hints from older clients. Copies/media are resolved from
    # the transaction and color is resolved from the analyzed source file.
    copies: int | None = Field(default=None, ge=1, le=99)
    color_mode: Literal["color", "grayscale"] | None = None
    media_size: InventoryPaperSize | None = None
    media_type: Literal[
        "auto",
        "plain",
        "photo_plus_glossy_ii",
        "photo_pro_luster",
        "photo_plus_semi_gloss",
        "glossy_photo",
        "matte_photo",
        "envelope",
        "ink_jet_hagaki_a",
        "ink_jet_hagaki",
        "hagaki_k_a",
        "hagaki_k",
        "hagaki_a",
        "hagaki",
        "inkjet_greeting_card",
        "card_stock",
    ] = "auto"
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    scaling: Literal["auto", "fit", "fill", "actual_size"] = "auto"
    quality: Literal["auto", "draft", "standard", "high"] = "auto"
    borderless: bool = False
    collate: bool = True
    duplex_pass: Literal["auto", "simplex", "front", "back"] = "auto"


class PrintAttemptRead(CamelModel):
    id: str
    job_order_item_id: str | None
    printer_id: str
    printer_name: str
    job_file_id: str | None
    filename: str | None
    copies: int
    color_mode: str
    media_size: str
    media_width_mm: float | None
    media_height_mm: float | None
    media_type: str
    orientation: str
    scaling: str
    quality: str
    borderless: bool
    collate: bool
    duplex_pass: Literal["simplex", "front", "back"]
    submitted_at: datetime
    result: PrintResult
    operator: str | None
    external_job_id: str | None
    spooler_status: Literal["submitted", "queued", "spooling", "printing", "paused", "error", "released"]
    spooler_pages_printed: int | None
    spooler_total_pages: int | None
    spooler_last_seen_at: datetime | None
    spooler_released_at: datetime | None
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
    name: str
    workflow_category: Literal["printing", "photocopy", "custom"]
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
