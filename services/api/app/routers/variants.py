from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import Variant
from ..db.session import get_db
from ..schemas.variants import VariantCreate, VariantRead, VariantUpdate

router = APIRouter(prefix="/variants", tags=["variants"], dependencies=[Depends(require_token)])


def _to_read(variant: Variant) -> VariantRead:
    return VariantRead(
        id=variant.id,
        label=variant.label,
        description=variant.description,
        is_active=variant.is_active,
        linked_product_count=len(variant.product_variants),
        created_at=variant.created_at,
        updated_at=variant.updated_at,
    )


@router.get("", response_model=list[VariantRead])
def list_variants(db: Session = Depends(get_db)) -> list[VariantRead]:
    variants = db.query(Variant).order_by(Variant.is_active.desc(), Variant.label).all()
    return [_to_read(variant) for variant in variants]


@router.post("", response_model=VariantRead, status_code=201)
def create_variant(payload: VariantCreate, db: Session = Depends(get_db)) -> VariantRead:
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="Enter a variant name.")
    duplicate = db.query(Variant).filter(func.lower(Variant.label) == label.lower()).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A global variant with this name already exists.")
    variant = Variant(
        label=label,
        description=(payload.description or "").strip() or None,
        is_active=payload.is_active,
    )
    db.add(variant)
    db.commit()
    db.refresh(variant)
    return _to_read(variant)


@router.put("/{variant_id}", response_model=VariantRead)
def update_variant(variant_id: str, payload: VariantUpdate, db: Session = Depends(get_db)) -> VariantRead:
    variant = db.get(Variant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found.")
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="Enter a variant name.")
    duplicate = (
        db.query(Variant)
        .filter(Variant.id != variant_id, func.lower(Variant.label) == label.lower())
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A global variant with this name already exists.")
    variant.label = label
    variant.description = (payload.description or "").strip() or None
    variant.is_active = payload.is_active
    db.commit()
    db.refresh(variant)
    return _to_read(variant)


@router.delete("/{variant_id}", status_code=204)
def delete_variant(variant_id: str, db: Session = Depends(get_db)) -> None:
    variant = db.get(Variant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found.")
    if variant.product_variants:
        raise HTTPException(
            status_code=409,
            detail="Remove this variant from its linked products before deleting it.",
        )
    db.delete(variant)
    db.commit()
