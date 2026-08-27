from __future__ import annotations

from pydantic import Field, field_validator

from .common import CamelModel


class BusinessProfileRead(CamelModel):
    business_name: str
    owner_name: str
    tagline: str | None
    email: str | None
    phone: str | None
    address: str | None
    quotation_prefix: str
    job_order_prefix: str


class BusinessProfileUpdate(CamelModel):
    business_name: str
    owner_name: str = Field(min_length=1, max_length=120)
    tagline: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    quotation_prefix: str = "QUO"
    job_order_prefix: str = "JOB"

    @field_validator("owner_name")
    @classmethod
    def normalize_owner_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Owner name is required.")
        return value
