from __future__ import annotations

from datetime import datetime

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
