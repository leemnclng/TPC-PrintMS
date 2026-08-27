from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import Quotation
from ..db.session import get_db
from ..schemas.quotations import QuotationItemRead, QuotationRead

router = APIRouter(prefix="/quotations", tags=["quotations"], dependencies=[Depends(require_token)])


def _to_read(quotation: Quotation) -> QuotationRead:
    items = [
        QuotationItemRead(
            id=item.id,
            product_id=item.product_id,
            product_name=item.product.name,
            variant_label=item.variant_label,
            quantity=item.quantity,
            unit_price=item.unit_price,
            ai_suggested=item.ai_suggested,
        )
        for item in quotation.items
    ]
    return QuotationRead(
        id=quotation.id,
        number=quotation.number,
        customer_id=quotation.customer_id,
        customer_name=quotation.customer.display_name,
        status=quotation.status,
        source_channel=quotation.source_channel,
        items=items,
        total=sum(item.quantity * item.unit_price for item in quotation.items),
        created_at=quotation.created_at,
        updated_at=quotation.updated_at,
    )


@router.get("", response_model=list[QuotationRead])
def list_quotations(db: Session = Depends(get_db)) -> list[QuotationRead]:
    quotations = db.query(Quotation).order_by(Quotation.created_at.desc()).all()
    return [_to_read(q) for q in quotations]


@router.get("/{quotation_id}", response_model=QuotationRead)
def get_quotation(quotation_id: str, db: Session = Depends(get_db)) -> QuotationRead:
    quotation = db.get(Quotation, quotation_id)
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found.")
    return _to_read(quotation)


@router.post("", status_code=501)
def create_quotation() -> None:
    # AI-assisted line-item generation and owner-approval pricing rules are
    # not yet specified — see docs/context/issues-log.md. This route exists
    # so the frontend has a stable contract to call once Phase 3 lands.
    raise HTTPException(
        status_code=501,
        detail="Quotation creation is not implemented yet — pricing rules are still undefined.",
    )
