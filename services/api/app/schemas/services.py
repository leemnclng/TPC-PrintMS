from __future__ import annotations

from datetime import datetime

from .common import CamelModel


class ServiceBase(CamelModel):
    name: str
    description: str | None = None
    is_active: bool = True


class ServiceCreate(ServiceBase):
    pass


class ServiceUpdate(ServiceBase):
    pass


class ServiceRead(ServiceBase):
    id: str
    product_count: int = 0
    created_at: datetime
    updated_at: datetime
