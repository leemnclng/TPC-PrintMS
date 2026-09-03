from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.db.models import InventoryPaperSize
from app.schemas.common import CamelModel

from .enums import PaperSize

# Values are the wire format directly (not run through the camelCase alias
# generator, which only renames fields) — "paperSize" matches the frontend
# union verbatim.
RateSource = Literal["product", "paperSize"]
AdjustmentKind = Literal["inkCoverage", "colorCoverage", "variant", "rounding"]


class PricingBreakdownItem(CamelModel):
    paper_size: PaperSize
    print_type: str
    pages: int = Field(ge=0)
    rate_per_page: float = Field(ge=0)
    subtotal: float = Field(ge=0)
    rate_source: RateSource = "paperSize"


class PricingAdjustment(CamelModel):
    kind: AdjustmentKind
    label: str
    basis: str
    amount: float


class PricingResult(CamelModel):
    suggested_price: float = Field(ge=0)
    base_subtotal: float = Field(default=0, ge=0)
    currency: str = "PHP"
    breakdown: list[PricingBreakdownItem] = Field(default_factory=list)
    adjustments: list[PricingAdjustment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PricingContext(CamelModel):
    product_id: str
    product_name: str
    print_type_label: str
    applies_ink_coverage: bool
    variant_id: str | None = None
    variant_name: str | None = None


class PricingRuleRead(CamelModel):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    paper_size: InventoryPaperSize
    paper_width_mm: float | None = None
    paper_height_mm: float | None = None
    print_type: str
    pricing_scope: str
    price_per_page: float = Field(ge=0)
    is_active: bool


class PricingRuleUpdate(CamelModel):
    id: str
    price_per_page: float = Field(ge=0)
    is_active: bool


class PricingRulesUpdate(CamelModel):
    rules: list[PricingRuleUpdate] = Field(min_length=1)


class PricingCategoryBase(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    operation_kind: Literal["printing", "photocopy", "adhoc"]
    material_ids: list[str] = Field(default_factory=list)


class PricingCategoryCreate(PricingCategoryBase):
    pass


class PricingCategoryUpdate(PricingCategoryBase):
    is_active: bool = True


class PricingCategoryRead(PricingCategoryBase):
    key: str
    is_builtin: bool
    is_active: bool
    linked_product_count: int
    created_at: datetime
    updated_at: datetime


class ScanPricingTierRead(CamelModel):
    id: str
    min_pages: int = Field(ge=1)
    max_pages: int | None = Field(default=None, ge=1)
    price_per_page: float = Field(ge=0)
    is_active: bool


class ScanPricingTierCreate(CamelModel):
    min_pages: int = Field(ge=1)
    max_pages: int | None = Field(default=None, ge=1)
    price_per_page: float = Field(ge=0)
    is_active: bool = True


class ScanPricingTierUpdate(ScanPricingTierCreate):
    pass
