from __future__ import annotations

from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from ..core.security import require_token
from ..db.models import Customer
from ..db.session import get_db
from ..schemas.customers import CustomerCreate, CustomerPageRead, CustomerRead, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"], dependencies=[Depends(require_token)])


def _to_read(customer: Customer) -> CustomerRead:
    return CustomerRead(
        id=customer.id,
        display_name=customer.display_name,
        contact_name=customer.contact_name,
        email=customer.email,
        phone=customer.phone,
        source_channel=customer.source_channel,
        notes=customer.notes,
        quotation_count=len(customer.quotations),
        job_order_count=len(customer.job_orders),
        created_at=customer.created_at,
        updated_at=customer.updated_at,
    )


@router.get("", response_model=list[CustomerRead])
def list_customers(db: Session = Depends(get_db)) -> list[CustomerRead]:
    customers = db.query(Customer).order_by(Customer.display_name).all()
    return [_to_read(c) for c in customers]


@router.get("/page", response_model=CustomerPageRead)
def page_customers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=10, le=100),
    db: Session = Depends(get_db),
) -> CustomerPageRead:
    query = db.query(Customer)
    total = query.count()
    total_pages = max(1, ceil(total / page_size))
    safe_page = min(page, total_pages)
    customers = (
        query.options(selectinload(Customer.quotations), selectinload(Customer.job_orders))
        .order_by(Customer.display_name)
        .offset((safe_page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return CustomerPageRead(
        items=[_to_read(customer) for customer in customers],
        page=safe_page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
        has_next=safe_page < total_pages,
        has_previous=safe_page > 1,
    )


@router.post("", response_model=CustomerRead, status_code=201)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)) -> CustomerRead:
    customer = Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return _to_read(customer)


@router.get("/{customer_id}", response_model=CustomerRead)
def get_customer(customer_id: str, db: Session = Depends(get_db)) -> CustomerRead:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    return _to_read(customer)


@router.put("/{customer_id}", response_model=CustomerRead)
def update_customer(customer_id: str, payload: CustomerUpdate, db: Session = Depends(get_db)) -> CustomerRead:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    for field, value in payload.model_dump().items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return _to_read(customer)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: str, db: Session = Depends(get_db)) -> None:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    db.delete(customer)
    db.commit()
