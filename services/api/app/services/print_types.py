from __future__ import annotations

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.models import PrintType, ProductPrintType


BUILTIN_PRINT_TYPES = (
    {
        "key": ProductPrintType.black_and_white.value,
        "label": "B&W (Black and white)",
        "description": "Grayscale output; the configured rate already includes paper and ink.",
        "color_mode": "grayscale",
        "applies_ink_coverage": False,
        "sort_order": 10,
    },
    {
        "key": ProductPrintType.semi_colored.value,
        "label": "Semi-colored",
        "description": "Color output for documents with limited color use.",
        "color_mode": "color",
        "applies_ink_coverage": True,
        "sort_order": 20,
    },
    {
        "key": ProductPrintType.colored.value,
        "label": "Colored",
        "description": "Full color output with measured ink coverage pricing.",
        "color_mode": "color",
        "applies_ink_coverage": True,
        "sort_order": 30,
    },
)


def ensure_builtin_print_types(db: Session) -> list[PrintType]:
    existing = {item.key for item in db.query(PrintType).all()}
    created = False
    for definition in BUILTIN_PRINT_TYPES:
        if definition["key"] in existing:
            continue
        db.add(PrintType(**definition, is_active=True))
        created = True
    if created:
        try:
            db.commit()
        except IntegrityError:
            # Pricing rules and the catalog may be requested together on an
            # empty database. The other request can win the seed race.
            db.rollback()
    return db.query(PrintType).order_by(PrintType.sort_order, PrintType.label).all()


def print_type_key(label: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return key[:64]
