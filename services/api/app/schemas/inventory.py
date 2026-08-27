from __future__ import annotations

from datetime import datetime

from pydantic import Field

from ..db.models import InventoryMovementKind, InventoryPaperSize
from .common import CamelModel


class InventoryItemBase(CamelModel):
    name: str
    category: str
    unit: str
    reorder_level: float = Field(default=0.0, ge=0)
    notes: str | None = None
    is_active: bool = True
    paper_size: InventoryPaperSize | None = None


class InventoryItemCreate(InventoryItemBase):
    opening_quantity: float = Field(default=0.0, ge=0)


class InventoryItemUpdate(InventoryItemBase):
    pass


class InventoryItemRead(InventoryItemBase):
    id: str
    quantity_on_hand: float
    linked_product_count: int
    created_at: datetime
    updated_at: datetime


class InventoryAdjustmentCreate(CamelModel):
    quantity_delta: float
    kind: InventoryMovementKind
    note: str | None = None
    job_order_id: str | None = None
    product_id: str | None = None


class InventoryMovementRead(CamelModel):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    inventory_item_unit: str
    kind: InventoryMovementKind
    quantity_delta: float
    balance_after: float
    job_order_id: str | None
    product_id: str | None
    note: str | None
    occurred_at: datetime
