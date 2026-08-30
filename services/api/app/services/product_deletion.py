from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..db.models import InventoryMovement, JobOrderItem, Product, QuotationItem

PRODUCT_RECOVERY_WINDOW = timedelta(days=5)


def product_has_history(product_id: str, db: Session) -> bool:
    return any(
        (
            db.query(JobOrderItem.id).filter(JobOrderItem.product_id == product_id).first(),
            db.query(QuotationItem.id).filter(QuotationItem.product_id == product_id).first(),
            db.query(InventoryMovement.id).filter(InventoryMovement.product_id == product_id).first(),
        )
    )


def finalize_expired_product_deletions(db: Session, *, now: datetime | None = None) -> int:
    """Permanently finalize expired recycle-bin entries.

    Unreferenced rows are physically deleted. Historically referenced rows keep
    only their product identity so old orders and stock movements remain
    readable; all editable catalogue configuration is removed and the row can
    no longer be restored.
    """

    current_time = now or datetime.utcnow()
    expired = (
        db.query(Product)
        .filter(
            Product.deleted_at.isnot(None),
            Product.deletion_finalized_at.is_(None),
            Product.purge_after <= current_time,
        )
        .all()
    )
    for product in expired:
        if product_has_history(product.id, db):
            product.variants.clear()
            product.material_assignments.clear()
            product.document_rates.clear()
            product.description = None
            product.deleted_was_active = None
            product.deletion_finalized_at = current_time
        else:
            db.delete(product)
    if expired:
        db.commit()
    return len(expired)
