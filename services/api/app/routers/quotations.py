from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import BusinessProfile, Product, Quotation
from ..db.session import get_db
from ..schemas.quotations import QuotationDocumentCreate, QuotationItemRead, QuotationRead
from ..services.sales_documents import SalesDocument, SalesDocumentLine, build_sales_document_pdf, pdf_to_png

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
def list_quotations(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)) -> list[QuotationRead]:
    quotations = db.query(Quotation).order_by(Quotation.created_at.desc()).limit(limit).all()
    return [_to_read(q) for q in quotations]


@router.get("/{quotation_id}", response_model=QuotationRead)
def get_quotation(quotation_id: str, db: Session = Depends(get_db)) -> QuotationRead:
    quotation = db.get(Quotation, quotation_id)
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found.")
    return _to_read(quotation)


@router.post("/document")
def generate_quotation_document(
    payload: QuotationDocumentCreate,
    format: Literal["pdf", "png"] = Query(default="pdf"),
    db: Session = Depends(get_db),
) -> Response:
    if payload.valid_until and payload.valid_until < date.today():
        raise HTTPException(status_code=422, detail="Quotation validity cannot end before today.")
    product_ids = {item.product_id for item in payload.items}
    products = db.query(Product).filter(Product.id.in_(product_ids), Product.deleted_at.is_(None)).all()
    product_by_id = {product.id: product for product in products}
    if set(product_by_id) != product_ids:
        raise HTTPException(status_code=422, detail="Select active products for every quotation line.")
    for item in payload.items:
        product = product_by_id[item.product_id]
        if item.variant_label and item.variant_label not in {variant.label for variant in product.variants}:
            raise HTTPException(status_code=422, detail=f"Select a configured variant for {product.name}.")
    issued_at = datetime.now()
    total = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
    document = SalesDocument(
        kind="Quotation", number=f"QUOTE-{issued_at:%Y%m%d-%H%M%S}",
        customer_name=payload.customer_name.strip(), customer_details=payload.customer_contact.strip() if payload.customer_contact else None,
        issued_at=issued_at, status="Prepared", valid_until=payload.valid_until,
        notes=payload.notes.strip() if payload.notes else None, subtotal=total, discount_name=None, discount_amount=0, total=total,
        lines=[SalesDocumentLine(
            label=product_by_id[item.product_id].name,
            detail=item.variant_label or product_by_id[item.product_id].service.name,
            quantity=item.quantity,
            unit_price=item.unit_price,
            total=round(item.quantity * item.unit_price, 2),
        ) for item in payload.items],
    )
    pdf = build_sales_document_pdf(document, db.query(BusinessProfile).first())
    content = pdf if format == "pdf" else pdf_to_png(pdf)
    media_type = "application/pdf" if format == "pdf" else "image/png"
    filename = f"quotation-{issued_at:%Y%m%d-%H%M%S}.{format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
