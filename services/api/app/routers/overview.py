from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import JobOrder, JobOrderStatus, Payment, PrintJob, PrintResult, Quotation, QuotationStatus
from ..db.session import get_db
from ..schemas.health import OverviewRead

router = APIRouter(prefix="/overview", tags=["overview"], dependencies=[Depends(require_token)])


@router.get("", response_model=OverviewRead)
def get_overview(db: Session = Depends(get_db)) -> OverviewRead:
    """Every number here is a real query against local data — there is no
    seeded/sample business data, so a fresh install honestly reads zero
    everywhere until the owner starts adding customers, quotes, and jobs."""

    status_counts = dict(
        db.query(JobOrder.status, func.count(JobOrder.id)).group_by(JobOrder.status).all()
    )
    job_orders_by_status = {status.value: status_counts.get(status, 0) for status in JobOrderStatus}

    quotations_awaiting_approval = (
        db.query(func.count(Quotation.id)).filter(Quotation.status == QuotationStatus.pending_approval).scalar()
        or 0
    )

    payments_awaiting_verification = (
        db.query(func.count(Payment.id)).filter(Payment.verified.is_(False)).scalar() or 0
    )

    horizon = datetime.utcnow() + timedelta(days=7)
    upcoming_deadlines = (
        db.query(func.count(JobOrder.id))
        .filter(
            JobOrder.due_date.is_not(None),
            JobOrder.due_date <= horizon,
            JobOrder.status.not_in([JobOrderStatus.completed, JobOrderStatus.cancelled]),
        )
        .scalar()
        or 0
    )

    print_queue_depth = (
        db.query(func.count(PrintJob.id)).filter(PrintJob.result == PrintResult.pending).scalar() or 0
    )

    return OverviewRead(
        job_orders_by_status=job_orders_by_status,
        quotations_awaiting_approval=quotations_awaiting_approval,
        payments_awaiting_verification=payments_awaiting_verification,
        upcoming_deadlines=upcoming_deadlines,
        print_queue_depth=print_queue_depth,
    )
