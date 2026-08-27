from __future__ import annotations

from datetime import datetime

from .common import CamelModel


class VariantBase(CamelModel):
    label: str
    description: str | None = None
    is_active: bool = True


class VariantCreate(VariantBase):
    pass


class VariantUpdate(VariantBase):
    pass


class VariantRead(VariantBase):
    id: str
    linked_product_count: int = 0
    created_at: datetime
    updated_at: datetime
