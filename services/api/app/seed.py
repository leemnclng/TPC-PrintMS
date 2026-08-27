"""First-run seed data.

Per docs/context/initial-pages.md, the scaffold must not invent business
metrics or sample data. The one exception is the business profile itself:
the user supplied their actual brand (name + tagline, from their logo), so
seeding it here reflects a real fact rather than a fabricated placeholder
like "Acme Printing Co."
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .db.models import BusinessProfile


def seed_business_profile(db: Session) -> None:
    if db.query(BusinessProfile).first():
        return
    db.add(
        BusinessProfile(
            business_name="The Paper Club",
            owner_name="Owner",
            tagline="Printing & Digital Services",
        )
    )
    db.commit()
