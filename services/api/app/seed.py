"""First-run seed data.

Per docs/context/initial-pages.md, the scaffold must not invent business
metrics or sample data. The one exception is the business profile itself:
the user supplied their actual brand (name + tagline, from their logo), so
seeding it here reflects a real fact rather than a fabricated placeholder
like "Acme Printing Co."
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .db.models import BusinessProfile, FailureReason


FAILURE_REASONS = (
    ("streaks_banding", "Streaks / banding", "machine"),
    ("faded_low_toner", "Faded / low toner", "machine"),
    ("wrong_color", "Wrong color", "machine"),
    ("misalignment_skew", "Misalignment / skew", "machine"),
    ("wrong_paper_size", "Wrong paper / size", "operator"),
    ("paper_jam", "Paper jam", "machine"),
    ("smudge_wet_ink", "Smudge / wet ink", "material"),
    ("duplex_back_wrong", "Duplex back side wrong", "operator"),
    ("wrong_file_version", "Wrong file / version", "operator"),
    ("customer_changed_request", "Customer changed request", "customer"),
    ("printer_error", "Printer error", "machine"),
    ("submission_failed", "Print submission failed", "machine"),
    ("cancelled_mid_print", "Cancelled mid-print", "operator"),
    ("other", "Other", "operator"),
)


def seed_failure_reasons(db: Session, *, commit: bool = True) -> None:
    existing = {reason.code for reason in db.query(FailureReason).all()}
    for order, (code, label, fault_type) in enumerate(FAILURE_REASONS):
        if code not in existing:
            db.add(FailureReason(
                code=code,
                label=label,
                fault_type=fault_type,
                is_system=code in {"printer_error", "submission_failed", "cancelled_mid_print"},
                sort_order=order,
            ))
    if commit:
        db.commit()
    else:
        db.flush()


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
