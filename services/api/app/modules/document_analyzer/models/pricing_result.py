from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.db.models import InventoryPaperSize, ProductPrintType
from app.schemas.common import CamelModel

from .enums import PaperSize

# Values are the wire format directly (not run through the camelCase alias
# generator, which only renames fields) — "paperSize" matches the frontend
# union verbatim.
RateSource = Literal["product", "paperSize"]


class PricingBreakdownItem(CamelModel):
    paper_size: PaperSize
    print_type: ProductPrintType
    pages: int = Field(ge=0)
    rate_per_page: float = Field(ge=0)
    subtotal: float = Field(ge=0)
    rate_source: RateSource = "paperSize"


class PricingResult(CamelModel):
    suggested_price: float = Field(ge=0)
    currency: str = "PHP"
    breakdown: list[PricingBreakdownItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PricingContext(CamelModel):
    product_id: str
    product_name: str


class PricingRuleRead(CamelModel):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    paper_size: InventoryPaperSize
    print_type: ProductPrintType
    price_per_page: float = Field(ge=0)
    is_active: bool


class PricingRuleUpdate(CamelModel):
    id: str
    price_per_page: float = Field(ge=0)
    is_active: bool


class PricingRulesUpdate(CamelModel):
    rules: list[PricingRuleUpdate] = Field(min_length=1)
