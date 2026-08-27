from __future__ import annotations

from datetime import datetime

from pydantic import Field

from ..db.models import InventoryPaperSize, ProductPrintType
from .common import CamelModel


class ProductVariantIn(CamelModel):
    variant_id: str
    price_adjustment: float = 0.0


class ProductVariantRead(ProductVariantIn):
    id: str
    label: str


class ProductDocumentRateIn(CamelModel):
    pricing_rule_id: str
    price_per_page: float = Field(ge=0)


class ProductDocumentRateRead(ProductDocumentRateIn):
    id: str
    paper_size: InventoryPaperSize
    print_type: ProductPrintType


class ProductMaterialAssignmentIn(CamelModel):
    inventory_item_id: str


class ProductMaterialAssignmentRead(ProductMaterialAssignmentIn):
    id: str
    inventory_item_name: str
    inventory_item_unit: str


class ProductBase(CamelModel):
    service_id: str
    name: str
    description: str | None = None
    print_type: ProductPrintType = ProductPrintType.black_and_white
    is_active: bool = True


class ProductCreate(ProductBase):
    variants: list[ProductVariantIn] = Field(default_factory=list)
    material_assignments: list[ProductMaterialAssignmentIn] = Field(min_length=1)
    document_rates: list[ProductDocumentRateIn] = Field(default_factory=list)


class ProductUpdate(ProductBase):
    variants: list[ProductVariantIn] = Field(default_factory=list)
    material_assignments: list[ProductMaterialAssignmentIn] = Field(default_factory=list)
    document_rates: list[ProductDocumentRateIn] = Field(default_factory=list)


class ProductRead(ProductBase):
    id: str
    service_name: str
    price_per_page: float = Field(ge=0)
    variants: list[ProductVariantRead] = Field(default_factory=list)
    material_assignments: list[ProductMaterialAssignmentRead] = Field(default_factory=list)
    document_rates: list[ProductDocumentRateRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
