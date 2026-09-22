from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from ..db.models import QuotationStatus, SourceChannel
from .common import CamelModel


class QuotationItemRead(CamelModel):
    id: str
    product_id: str
    product_name: str
    variant_label: str | None
    quantity: int
    unit_price: float
    ai_suggested: bool


class QuotationDocumentItem(CamelModel):
    product_id: str
    variant_label: str | None = Field(default=None, max_length=120)
    quantity: int = Field(ge=1, le=100000)
    unit_price: float = Field(ge=0, allow_inf_nan=False)


class QuotationDocumentCreate(CamelModel):
    customer_name: str = Field(min_length=1, max_length=200)
    customer_contact: str | None = Field(default=None, max_length=500)
    valid_until: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    items: list[QuotationDocumentItem] = Field(min_length=1, max_length=50)


class QuotationRead(CamelModel):
    id: str
    number: str
    customer_id: str
    customer_name: str
    status: QuotationStatus
    source_channel: SourceChannel
    items: list[QuotationItemRead] = []
    total: float
    created_at: datetime
    updated_at: datetime
