from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator

from .common import CamelModel

ExpenseSource = Literal["manual", "stock_purchase"]


class BusinessExpenseBase(CamelModel):
    category: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=240)
    amount: float = Field(gt=0, allow_inf_nan=False)
    paid_to: str | None = Field(default=None, max_length=200)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    spent_on: date

    @field_validator("category", "description")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("This field is required.")
        return value

    @field_validator("paid_to", "reference", "notes")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        return value or None


class BusinessExpenseCreate(BusinessExpenseBase):
    pass


class BusinessExpenseUpdate(BusinessExpenseBase):
    pass


class ExpenseLedgerEntryRead(CamelModel):
    id: str
    source: ExpenseSource
    category: str
    description: str
    amount: float
    paid_to: str | None
    reference: str | None
    notes: str | None
    spent_on: date
    created_at: datetime


class ExpenseCategoryTotalRead(CamelModel):
    category: str
    amount: float
    entry_count: int


class ExpenseLedgerRead(CamelModel):
    entries: list[ExpenseLedgerEntryRead]
    total_amount: float
    manual_expense_total: float
    stock_purchase_total: float
    entry_count: int
    category_totals: list[ExpenseCategoryTotalRead]
    available_categories: list[str]
