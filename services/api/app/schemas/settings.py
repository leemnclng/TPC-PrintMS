from __future__ import annotations

from .common import CamelModel


class BusinessProfileRead(CamelModel):
    business_name: str
    tagline: str | None
    email: str | None
    phone: str | None
    address: str | None
    quotation_prefix: str
    job_order_prefix: str


class BusinessProfileUpdate(CamelModel):
    business_name: str
    tagline: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    quotation_prefix: str = "QUO"
    job_order_prefix: str = "JOB"
