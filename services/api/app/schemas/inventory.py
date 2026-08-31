from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from ..db.models import InventoryMovementKind, InventoryPaperSize
from .common import CamelModel


class InventoryItemBase(CamelModel):
    name: str
    category: str
    unit: str
    reorder_level: float = Field(default=0.0, ge=0)
    purchase_price: float | None = Field(default=None, ge=0)
    purchase_price_basis: Literal["unit", "ream"] = "unit"
    sheets_per_ream: int | None = Field(default=None, gt=0)
    notes: str | None = None
    is_active: bool = True
    paper_size: InventoryPaperSize | None = None
    paper_width_mm: float | None = Field(default=None, gt=0)
    paper_height_mm: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_purchase_price_basis(self):
        is_sheet = self.unit.strip().lower() in {"sheet", "sheets"}
        if self.purchase_price_basis == "ream":
            if not is_sheet:
                raise ValueError("Whole-ream cost is available only for materials counted by sheet.")
            if self.sheets_per_ream is None:
                raise ValueError("Enter the number of sheets in the ream.")
        elif self.sheets_per_ream is not None:
            raise ValueError("Sheets per ream is used only with whole-ream cost.")
        return self


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


class PaperSizeDefinitionRead(CamelModel):
    key: InventoryPaperSize
    label: str
    width_mm: float | None
    height_mm: float | None
    group: Literal["document", "photo", "envelope", "card", "custom"]
