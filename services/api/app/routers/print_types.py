from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import PrintType
from ..db.session import get_db
from ..schemas.print_types import PrintTypeCreate, PrintTypeRead, PrintTypeUpdate
from ..services.print_types import ensure_builtin_print_types, print_type_key

router = APIRouter(prefix="/print-types", tags=["print-types"], dependencies=[Depends(require_token)])


@router.get("", response_model=list[PrintTypeRead])
def list_print_types(db: Session = Depends(get_db)) -> list[PrintType]:
    return ensure_builtin_print_types(db)


@router.post("", response_model=PrintTypeRead, status_code=201)
def create_print_type(payload: PrintTypeCreate, db: Session = Depends(get_db)) -> PrintType:
    ensure_builtin_print_types(db)
    label = payload.label.strip()
    if len(label) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters for the print type name.")
    key = print_type_key(label)
    if not key:
        raise HTTPException(status_code=422, detail="Enter a print type name using letters or numbers.")
    if db.get(PrintType, key) or db.query(PrintType).filter(func.lower(PrintType.label) == label.lower()).first():
        raise HTTPException(status_code=409, detail="A print type with this name already exists.")
    max_sort_order = db.query(func.max(PrintType.sort_order)).scalar() or 0
    definition = PrintType(
        key=key,
        label=label,
        description=payload.description.strip() if payload.description else None,
        color_mode=payload.color_mode,
        applies_ink_coverage=payload.applies_ink_coverage,
        is_active=True,
        sort_order=max_sort_order + 10,
    )
    db.add(definition)
    db.commit()
    db.refresh(definition)
    return definition


@router.put("/{key}", response_model=PrintTypeRead)
def update_print_type(key: str, payload: PrintTypeUpdate, db: Session = Depends(get_db)) -> PrintType:
    definition = db.get(PrintType, key)
    if definition is None:
        raise HTTPException(status_code=404, detail="Print type not found.")
    label = payload.label.strip()
    if len(label) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters for the print type name.")
    duplicate = (
        db.query(PrintType)
        .filter(PrintType.key != key, func.lower(PrintType.label) == label.lower())
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A print type with this name already exists.")
    definition.label = label
    definition.description = payload.description.strip() if payload.description else None
    definition.color_mode = payload.color_mode
    definition.applies_ink_coverage = payload.applies_ink_coverage
    definition.is_active = payload.is_active
    db.commit()
    db.refresh(definition)
    return definition
