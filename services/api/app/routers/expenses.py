from __future__ import annotations

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import BusinessExpense, InventoryStockPurchase
from ..db.session import get_db
from ..schemas.expenses import (
    BusinessExpenseCreate,
    BusinessExpenseUpdate,
    ExpenseCategoryTotalRead,
    ExpenseLedgerEntryRead,
    ExpenseLedgerRead,
    ExpenseSource,
)

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(require_token)])


def _validate_dates(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")


def _manual_entry(expense: BusinessExpense) -> ExpenseLedgerEntryRead:
    return ExpenseLedgerEntryRead(
        id=expense.id,
        source="manual",
        category=expense.category,
        description=expense.description,
        amount=expense.amount,
        paid_to=expense.paid_to,
        reference=expense.reference,
        notes=expense.notes,
        spent_on=expense.spent_on,
        created_at=expense.created_at,
    )


def _stock_entry(purchase: InventoryStockPurchase) -> ExpenseLedgerEntryRead:
    quantity = f"{purchase.quantity_purchased:g} {purchase.purchase_unit}"
    return ExpenseLedgerEntryRead(
        id=purchase.id,
        source="stock_purchase",
        category="Stock purchase",
        description=f"{purchase.material_name} · {quantity}",
        amount=purchase.total_cost,
        paid_to=purchase.supplier,
        reference=purchase.reference,
        notes=purchase.notes,
        spent_on=purchase.purchased_on,
        created_at=purchase.created_at,
    )


@router.get("", response_model=ExpenseLedgerRead)
def list_expenses(
    start_date: date,
    end_date: date,
    source: ExpenseSource | None = None,
    category: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
) -> ExpenseLedgerRead:
    _validate_dates(start_date, end_date)
    manual_query = db.query(BusinessExpense).filter(
        BusinessExpense.spent_on >= start_date,
        BusinessExpense.spent_on <= end_date,
    )
    stock_query = db.query(InventoryStockPurchase).filter(
        InventoryStockPurchase.purchased_on >= start_date,
        InventoryStockPurchase.purchased_on <= end_date,
    )
    search = q.strip() if q else None
    if search:
        token = f"%{search}%"
        manual_query = manual_query.filter(or_(
            BusinessExpense.description.ilike(token),
            BusinessExpense.category.ilike(token),
            BusinessExpense.paid_to.ilike(token),
            BusinessExpense.reference.ilike(token),
            BusinessExpense.notes.ilike(token),
        ))
        stock_query = stock_query.filter(or_(
            InventoryStockPurchase.material_name.ilike(token),
            InventoryStockPurchase.supplier.ilike(token),
            InventoryStockPurchase.reference.ilike(token),
            InventoryStockPurchase.notes.ilike(token),
        ))

    entries: list[ExpenseLedgerEntryRead] = []
    if source in (None, "manual") and (not category or category.casefold() != "stock purchase"):
        manual = manual_query.all()
        if category:
            manual = [expense for expense in manual if expense.category.casefold() == category.casefold()]
        entries.extend(_manual_entry(expense) for expense in manual)
    if source in (None, "stock_purchase") and (not category or category.casefold() == "stock purchase"):
        entries.extend(_stock_entry(purchase) for purchase in stock_query.all())
    entries.sort(key=lambda item: (item.spent_on, item.created_at, item.id), reverse=True)

    category_groups: dict[str, list[float]] = defaultdict(list)
    for entry in entries:
        category_groups[entry.category].append(entry.amount)
    category_totals = sorted(
        (
            ExpenseCategoryTotalRead(category=name, amount=round(sum(amounts), 2), entry_count=len(amounts))
            for name, amounts in category_groups.items()
        ),
        key=lambda item: (-item.amount, item.category.casefold()),
    )
    manual_total = round(sum(item.amount for item in entries if item.source == "manual"), 2)
    stock_total = round(sum(item.amount for item in entries if item.source == "stock_purchase"), 2)
    manual_categories = {row[0] for row in db.query(BusinessExpense.category).distinct().all()}
    return ExpenseLedgerRead(
        entries=entries,
        total_amount=round(manual_total + stock_total, 2),
        manual_expense_total=manual_total,
        stock_purchase_total=stock_total,
        entry_count=len(entries),
        category_totals=category_totals,
        available_categories=sorted(manual_categories | {"Stock purchase"}, key=str.casefold),
    )


def _validate_payload(payload: BusinessExpenseCreate | BusinessExpenseUpdate) -> None:
    if payload.spent_on > date.today():
        raise HTTPException(status_code=422, detail="Expense date cannot be in the future.")
    if abs(payload.amount * 100 - round(payload.amount * 100)) > 0.000001:
        raise HTTPException(status_code=422, detail="Amount supports up to two decimal places.")
    if payload.category.casefold() == "stock purchase":
        raise HTTPException(status_code=422, detail="Stock purchase is reserved for costs linked from Inventory.")


@router.post("", response_model=ExpenseLedgerEntryRead, status_code=201)
def create_expense(payload: BusinessExpenseCreate, db: Session = Depends(get_db)) -> ExpenseLedgerEntryRead:
    _validate_payload(payload)
    expense = BusinessExpense(**payload.model_dump())
    expense.amount = round(expense.amount, 2)
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return _manual_entry(expense)


def _get_expense(expense_id: str, db: Session) -> BusinessExpense:
    expense = db.get(BusinessExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Business expense not found.")
    return expense


@router.put("/{expense_id}", response_model=ExpenseLedgerEntryRead)
def update_expense(expense_id: str, payload: BusinessExpenseUpdate, db: Session = Depends(get_db)) -> ExpenseLedgerEntryRead:
    _validate_payload(payload)
    expense = _get_expense(expense_id, db)
    for field, value in payload.model_dump().items():
        setattr(expense, field, value)
    expense.amount = round(expense.amount, 2)
    db.commit()
    db.refresh(expense)
    return _manual_entry(expense)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(expense_id: str, db: Session = Depends(get_db)) -> None:
    expense = _get_expense(expense_id, db)
    db.delete(expense)
    db.commit()
