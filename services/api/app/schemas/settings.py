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


class StorageStatusRead(CamelModel):
    stage: str
    environment_directory: str
    database_path: str
    managed_files_directory: str
    config_path: str
    backup_directory: str
    managed_file_count: int
    managed_file_bytes: int
    backup_count: int
    last_backup_at: str | None
    config_updated_at: str | None


class RestoreResultRead(CamelModel):
    stage: str
    restored_at: str
    managed_file_count: int
    safety_backup_filename: str
    message: str
