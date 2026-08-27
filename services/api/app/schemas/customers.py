from __future__ import annotations

from datetime import datetime

from ..db.models import SourceChannel
from .common import CamelModel


class CustomerBase(CamelModel):
    display_name: str
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    source_channel: SourceChannel = SourceChannel.other
    notes: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(CustomerBase):
    pass


class CustomerRead(CustomerBase):
    id: str
    quotation_count: int = 0
    job_order_count: int = 0
    created_at: datetime
    updated_at: datetime
