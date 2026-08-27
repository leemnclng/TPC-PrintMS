from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import BusinessProfile
from ..db.session import get_db
from ..schemas.settings import BusinessProfileRead, BusinessProfileUpdate

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_token)])


def _get_or_create(db: Session) -> BusinessProfile:
    profile = db.query(BusinessProfile).first()
    if not profile:
        # Should already exist from app.seed at startup; this is a defensive
        # fallback only.
        profile = BusinessProfile(business_name="Untitled Business")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/business-profile", response_model=BusinessProfileRead)
def get_business_profile(db: Session = Depends(get_db)) -> BusinessProfile:
    return _get_or_create(db)


@router.put("/business-profile", response_model=BusinessProfileRead)
def update_business_profile(payload: BusinessProfileUpdate, db: Session = Depends(get_db)) -> BusinessProfile:
    profile = _get_or_create(db)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile
