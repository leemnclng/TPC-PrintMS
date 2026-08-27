from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from ..db.models import JobOrderStatus, PrintSides
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


class JobOrderItemRead(CamelModel):
    id: str
    product_id: str
    product_name: str
    service_name: str
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
    uploaded_at: datetime


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
    created_at: datetime
    updated_at: datetime
