from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import InventoryItem, JobOrderItem, JobOrderItemStatusEvent, Payment, Product
from ..db.session import get_db
from ..schemas.reports import (
    OperationalReportRead,
    ReportInventoryItemRead,
    ReportInventoryRead,
    ReportPaymentMethodRead,
    ReportReattemptProductRead,
    ReportReattemptsRead,
    ReportSalesRead,
)

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_token)])
ReportPeriod = Literal["daily", "weekly", "monthly"]


def _period_dates(period: ReportPeriod, anchor: date) -> tuple[date, date]:
    if period == "daily":
        return anchor, anchor
    if period == "weekly":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    start = anchor.replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month - timedelta(days=1)


def _utc_query_bounds(start: date, end: date, timezone_offset_minutes: int) -> tuple[datetime, datetime]:
    """Convert the renderer's local calendar boundaries into stored UTC timestamps.

    JavaScript getTimezoneOffset() is UTC minus local time, so adding it to
    local midnight yields the equivalent naive UTC value used in SQLite.
    """

    offset = timedelta(minutes=timezone_offset_minutes)
    return datetime.combine(start, time.min) + offset, datetime.combine(end + timedelta(days=1), time.min) + offset


def _inventory_status(item: InventoryItem) -> Literal["healthy", "low", "out"]:
    if item.quantity_on_hand <= 0:
        return "out"
    if item.quantity_on_hand <= item.reorder_level:
        return "low"
    return "healthy"


@router.get("", response_model=OperationalReportRead)
def get_operational_report(
    period: ReportPeriod = Query(default="daily"),
    anchor_date: date = Query(default_factory=date.today),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
) -> OperationalReportRead:
    period_start, period_end = _period_dates(period, anchor_date)
    query_start, query_end = _utc_query_bounds(period_start, period_end, timezone_offset_minutes)
    generated_at = datetime.now(timezone.utc)

    payments = (
        db.query(Payment)
        .filter(
            Payment.verified.is_(True),
            Payment.recorded_at >= query_start,
            Payment.recorded_at < query_end,
        )
        .order_by(Payment.recorded_at)
        .all()
    )
    payment_methods: dict[str, dict[str, float | int]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    for payment in payments:
        method = payment.method.value if hasattr(payment.method, "value") else str(payment.method)
        payment_methods[method]["amount"] = float(payment_methods[method]["amount"]) + payment.amount
        payment_methods[method]["count"] = int(payment_methods[method]["count"]) + 1
    sales = ReportSalesRead(
        total_sales=round(sum(payment.amount for payment in payments), 2),
        transaction_count=len({payment.job_order_id for payment in payments}),
        verified_payment_count=len(payments),
        by_payment_method=[
            ReportPaymentMethodRead(
                method=method,
                amount=round(float(values["amount"]), 2),
                payment_count=int(values["count"]),
            )
            for method, values in sorted(payment_methods.items())
        ],
    )

    re_attempt_events = (
        db.query(JobOrderItemStatusEvent, JobOrderItem, Product)
        .join(JobOrderItem, JobOrderItemStatusEvent.job_order_item_id == JobOrderItem.id)
        .join(Product, JobOrderItem.product_id == Product.id)
        .filter(
            JobOrderItemStatusEvent.from_status == "ready",
            JobOrderItemStatusEvent.to_status == "queued",
            JobOrderItemStatusEvent.occurred_at >= query_start,
            JobOrderItemStatusEvent.occurred_at < query_end,
        )
        .order_by(JobOrderItemStatusEvent.occurred_at)
        .all()
    )
    product_re_attempts: dict[str, dict[str, object]] = {}
    affected_job_ids: set[str] = set()
    for _event, item, product in re_attempt_events:
        affected_job_ids.add(item.job_order_id)
        entry = product_re_attempts.setdefault(product.id, {"name": product.name, "count": 0, "jobs": set()})
        entry["count"] = int(entry["count"]) + 1
        jobs = entry["jobs"]
        if isinstance(jobs, set):
            jobs.add(item.job_order_id)
    re_attempts = ReportReattemptsRead(
        total_re_attempts=len(re_attempt_events),
        affected_job_count=len(affected_job_ids),
        affected_product_count=len(product_re_attempts),
        by_product=sorted(
            [
                ReportReattemptProductRead(
                    product_id=product_id,
                    product_name=str(values["name"]),
                    re_attempt_count=int(values["count"]),
                    affected_job_count=len(values["jobs"]) if isinstance(values["jobs"], set) else 0,
                )
                for product_id, values in product_re_attempts.items()
            ],
            key=lambda item: (-item.re_attempt_count, item.product_name.lower()),
        ),
    )

    inventory_items = db.query(InventoryItem).order_by(InventoryItem.name).all()
    active_items = [item for item in inventory_items if item.is_active]
    report_items = [
        ReportInventoryItemRead(
            id=item.id,
            name=item.name,
            category=item.category,
            unit=item.unit,
            quantity_on_hand=item.quantity_on_hand,
            reorder_level=item.reorder_level,
            paper_size=item.paper_size.value if item.paper_size else None,
            status=_inventory_status(item),
        )
        for item in active_items
    ]
    status_order = {"out": 0, "low": 1, "healthy": 2}
    report_items.sort(key=lambda item: (status_order[item.status], item.name.lower()))
    inventory = ReportInventoryRead(
        as_of=generated_at,
        active_item_count=len(active_items),
        inactive_item_count=int(db.query(func.count(InventoryItem.id)).filter(InventoryItem.is_active.is_(False)).scalar() or 0),
        healthy_count=sum(item.status == "healthy" for item in report_items),
        low_stock_count=sum(item.status == "low" for item in report_items),
        out_of_stock_count=sum(item.status == "out" for item in report_items),
        items=report_items,
    )

    return OperationalReportRead(
        period=period,
        anchor_date=anchor_date,
        period_start=period_start,
        period_end=period_end,
        generated_at=generated_at,
        sales=sales,
        re_attempts=re_attempts,
        inventory=inventory,
    )
