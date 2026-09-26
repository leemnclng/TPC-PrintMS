from __future__ import annotations

from collections import defaultdict
import csv
from datetime import date, datetime, time, timedelta, timezone
from io import StringIO
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.security import require_token
from ..db.models import (
    Customer,
    DocumentPricingRule,
    FailureReason,
    InventoryItem,
    JobOrder,
    JobOrderItem,
    ObservedPrintJob,
    Payment,
    PrintFailure,
    PrintJob,
    PrintResult,
    Product,
)
from ..db.session import get_db
from ..schemas.reports import (
    OperationalReportRead,
    ReportInventoryItemRead,
    ReportInventoryRead,
    ReportPaymentMethodRead,
    ReportReattemptProductRead,
    ReportReattemptsRead,
    ReportSalesRead,
    DiscountedJobOrderRead,
    DiscountedJobOrderPageRead,
    FailureReasonCreate,
    FailureReasonRead,
    FailureReasonUpdate,
    FailureReportRead,
    PrinterReliabilityRead,
    PrinterReliabilityReportRead,
    ReconciliationReportRead,
    ReconciliationRowRead,
    ReportBreakdownRead,
)

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_token)])
ReportPeriod = Literal["daily", "weekly", "monthly", "custom"]


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


def _validate_period(start_date: date, end_date: date, timezone_offset_minutes: int) -> tuple[datetime, datetime]:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="Report end date must be on or after its start date.")
    return _utc_query_bounds(start_date, end_date, timezone_offset_minutes)


def _csv_response(filename: str, rows: list[tuple[object, object]]) -> Response:
    output = StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(("metric", "value"))
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _breakdowns(entries: dict[str, dict[str, object]]) -> list[ReportBreakdownRead]:
    return sorted(
        [
            ReportBreakdownRead(
                key=key,
                label=str(value["label"]),
                count=int(value["count"]),
                spoiled_sheets=int(value.get("spoiled_sheets", 0)),
                material_cost=round(float(value.get("material_cost", 0)), 2),
            )
            for key, value in entries.items()
        ],
        key=lambda entry: (-entry.count, entry.label.lower()),
    )


@router.get("/failure-reasons", response_model=list[FailureReasonRead])
def list_failure_reasons(include_inactive: bool = False, db: Session = Depends(get_db)) -> list[FailureReason]:
    query = db.query(FailureReason)
    if not include_inactive:
        query = query.filter(FailureReason.is_active.is_(True))
    return query.order_by(FailureReason.sort_order, FailureReason.label).all()


@router.post("/failure-reasons", response_model=FailureReasonRead, status_code=201)
def create_failure_reason(payload: FailureReasonCreate, db: Session = Depends(get_db)) -> FailureReason:
    code = payload.code.strip().lower().replace(" ", "_")
    if not code or not all(character.isalnum() or character == "_" for character in code):
        raise HTTPException(status_code=422, detail="Reason code must use letters, numbers, and underscores.")
    if db.get(FailureReason, code):
        raise HTTPException(status_code=409, detail="That failure reason code already exists.")
    reason = FailureReason(code=code, label=payload.label.strip(), fault_type=payload.fault_type, is_active=payload.is_active)
    db.add(reason)
    db.commit()
    db.refresh(reason)
    return reason


@router.put("/failure-reasons/{code}", response_model=FailureReasonRead)
def update_failure_reason(code: str, payload: FailureReasonUpdate, db: Session = Depends(get_db)) -> FailureReason:
    reason = db.get(FailureReason, code)
    if not reason:
        raise HTTPException(status_code=404, detail="Failure reason not found.")
    if reason.is_system and not payload.is_active:
        raise HTTPException(status_code=409, detail="System failure reasons must remain active.")
    reason.label = payload.label.strip()
    reason.fault_type = payload.fault_type
    reason.is_active = payload.is_active
    db.commit()
    db.refresh(reason)
    return reason


@router.get("/reconciliation", response_model=None)
def get_reconciliation_report(
    start_date: date = Query(...),
    end_date: date = Query(...),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    format: Literal["json", "csv"] = Query(default="json"),
    db: Session = Depends(get_db),
) -> ReconciliationReportRead | Response:
    query_start, query_end = _validate_period(start_date, end_date, timezone_offset_minutes)
    attempts = db.query(PrintJob).filter(
        PrintJob.result == PrintResult.succeeded,
        PrintJob.submitted_at >= query_start,
        PrintJob.submitted_at < query_end,
    ).order_by(PrintJob.submitted_at).all()
    confirmed = [attempt for attempt in attempts if attempt.spooler_key and attempt.spooler_released_at]
    unconfirmed = [attempt for attempt in attempts if attempt not in confirmed]
    mismatches = [
        attempt for attempt in confirmed
        if (attempt.spooler_pages_printed or 0) > 0
        and attempt.spooler_total_pages is not None
        and attempt.spooler_pages_printed != attempt.spooler_total_pages
    ]
    observed = db.query(ObservedPrintJob).filter(
        ObservedPrintJob.first_seen_at >= query_start,
        ObservedPrintJob.first_seen_at < query_end,
    ).order_by(ObservedPrintJob.first_seen_at).all()
    leakage = [job for job in observed if job.review_status == "unreviewed"]
    linked = [job for job in observed if job.review_status == "linked"]
    leakage_pages = sum((job.pages_printed if (job.pages_printed or 0) > 0 else job.total_pages or 0) for job in leakage)
    mono_rule = db.query(DocumentPricingRule).filter(
        DocumentPricingRule.print_type == "black_and_white",
        DocumentPricingRule.is_active.is_(True),
    ).order_by(DocumentPricingRule.created_at).first()
    leakage_estimate = round(leakage_pages * (mono_rule.price_per_page if mono_rule else 0), 2)
    rows = [
        ReconciliationRowRead(
            id=attempt.id, kind="unconfirmed", printer_name=attempt.printer.display_name,
            document_name=attempt.job_file.original_filename if attempt.job_file else None,
            expected_pages=attempt.spooler_total_pages, pages_printed=attempt.spooler_pages_printed,
            job_order_id=attempt.job_order_id, observed_print_job_id=None,
        ) for attempt in unconfirmed
    ] + [
        ReconciliationRowRead(
            id=attempt.id, kind="mismatch", printer_name=attempt.printer.display_name,
            document_name=attempt.job_file.original_filename if attempt.job_file else None,
            expected_pages=attempt.spooler_total_pages, pages_printed=attempt.spooler_pages_printed,
            job_order_id=attempt.job_order_id, observed_print_job_id=None,
        ) for attempt in mismatches
    ] + [
        ReconciliationRowRead(
            id=job.id, kind="leakage", printer_name=job.printer_name, document_name=job.document_name,
            expected_pages=job.total_pages, pages_printed=job.pages_printed,
            job_order_id=job.linked_job_order_id, observed_print_job_id=job.id,
        ) for job in leakage
    ] + [
        ReconciliationRowRead(
            id=job.id, kind="linked_external", printer_name=job.printer_name, document_name=job.document_name,
            expected_pages=job.total_pages, pages_printed=job.pages_printed,
            job_order_id=job.linked_job_order_id, observed_print_job_id=job.id,
        ) for job in linked
    ]
    report = ReconciliationReportRead(
        generated_at=datetime.now(timezone.utc),
        spooler_available=settings.resolved_printer_platform == "windows",
        billed_prints=len(attempts), spooler_confirmed=len(confirmed), unconfirmed=len(unconfirmed),
        page_mismatches=len(mismatches), leakage_count=len(leakage), leakage_pages=leakage_pages,
        leakage_estimate=leakage_estimate, linked_external_prints=len(linked), rows=rows,
    )
    if format == "csv":
        return _csv_response("print-reconciliation.csv", [
            ("billed_prints", report.billed_prints), ("spooler_confirmed", report.spooler_confirmed),
            ("unconfirmed", report.unconfirmed), ("page_mismatches", report.page_mismatches),
            ("leakage_count", report.leakage_count), ("leakage_pages", report.leakage_pages),
            ("leakage_estimate", report.leakage_estimate), ("linked_external_prints", report.linked_external_prints),
        ])
    return report


@router.get("/failures", response_model=None)
def get_failure_report(
    start_date: date = Query(...),
    end_date: date = Query(...),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    format: Literal["json", "csv"] = Query(default="json"),
    db: Session = Depends(get_db),
) -> FailureReportRead | Response:
    query_start, query_end = _validate_period(start_date, end_date, timezone_offset_minutes)
    failures = db.query(PrintFailure).filter(
        PrintFailure.occurred_at >= query_start,
        PrintFailure.occurred_at < query_end,
    ).order_by(PrintFailure.occurred_at).all()
    groupings: dict[str, dict[str, dict[str, object]]] = {
        "source": {}, "reason": {}, "fault": {}, "product": {}, "printer": {},
    }
    for failure in failures:
        labels = [
            ("source", failure.source, failure.source.replace("_", " ").title()),
            ("reason", failure.reason_code, failure.reason.label),
            ("fault", failure.reason.fault_type, failure.reason.fault_type.title()),
        ]
        if failure.job_order_item:
            labels.append(("product", failure.job_order_item.product_id, failure.job_order_item.product.name))
        if failure.printer_name:
            labels.append(("printer", failure.printer_name, failure.printer_name))
        for group, key, label in labels:
            entry = groupings[group].setdefault(key, {"label": label, "count": 0, "spoiled_sheets": 0, "material_cost": 0.0})
            entry["count"] = int(entry["count"]) + 1
            entry["spoiled_sheets"] = int(entry["spoiled_sheets"]) + (failure.spoiled_sheets or 0)
            entry["material_cost"] = float(entry["material_cost"]) + (failure.material_cost_snapshot or 0)
    print_count = db.query(func.count(PrintJob.id)).filter(
        PrintJob.submitted_at >= query_start, PrintJob.submitted_at < query_end,
    ).scalar() or 0
    report = FailureReportRead(
        generated_at=datetime.now(timezone.utc), total_failures=len(failures),
        spoiled_sheets=sum(failure.spoiled_sheets or 0 for failure in failures),
        material_cost=round(sum(failure.material_cost_snapshot or 0 for failure in failures), 2),
        failure_rate=round(len(failures) / print_count * 100, 2) if print_count else 0,
        by_source=_breakdowns(groupings["source"]), by_reason=_breakdowns(groupings["reason"]),
        by_fault_type=_breakdowns(groupings["fault"]), by_product=_breakdowns(groupings["product"]),
        by_printer=_breakdowns(groupings["printer"]),
    )
    if format == "csv":
        return _csv_response("waste-and-quality.csv", [
            ("total_failures", report.total_failures), ("spoiled_sheets", report.spoiled_sheets),
            ("material_cost", report.material_cost), ("failure_rate_percent", report.failure_rate),
        ])
    return report


@router.get("/printers", response_model=None)
def get_printer_reliability_report(
    start_date: date = Query(...),
    end_date: date = Query(...),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    format: Literal["json", "csv"] = Query(default="json"),
    db: Session = Depends(get_db),
) -> PrinterReliabilityReportRead | Response:
    query_start, query_end = _validate_period(start_date, end_date, timezone_offset_minutes)
    attempts = db.query(PrintJob).filter(PrintJob.submitted_at >= query_start, PrintJob.submitted_at < query_end).all()
    failures = db.query(PrintFailure).filter(PrintFailure.occurred_at >= query_start, PrintFailure.occurred_at < query_end).all()
    names = sorted({attempt.printer.display_name for attempt in attempts} | {failure.printer_name for failure in failures if failure.printer_name})
    rows: list[PrinterReliabilityRead] = []
    for name in names:
        printer_attempts = [attempt for attempt in attempts if attempt.printer.display_name == name]
        printer_failures = [failure for failure in failures if failure.printer_name == name]
        sources: dict[str, dict[str, object]] = {}
        for failure in printer_failures:
            entry = sources.setdefault(failure.source, {"label": failure.source.replace("_", " ").title(), "count": 0})
            entry["count"] = int(entry["count"]) + 1
        rows.append(PrinterReliabilityRead(
            printer_name=name, jobs=len(printer_attempts),
            pages=sum(attempt.spooler_pages_printed if attempt.spooler_pages_printed is not None else attempt.spooler_total_pages or 0 for attempt in printer_attempts),
            failures=len(printer_failures), error_rate=round(len(printer_failures) / len(printer_attempts) * 100, 2) if printer_attempts else 0,
            color_jobs=sum(attempt.color_mode == "color" for attempt in printer_attempts),
            grayscale_jobs=sum(attempt.color_mode == "grayscale" for attempt in printer_attempts),
            duplex_jobs=sum(attempt.duplex_pass in {"front", "back"} for attempt in printer_attempts),
            failures_by_source=_breakdowns(sources),
        ))
    report = PrinterReliabilityReportRead(
        generated_at=datetime.now(timezone.utc),
        spooler_available=settings.resolved_printer_platform == "windows",
        printers=rows,
    )
    if format == "csv":
        return _csv_response("printer-reliability.csv", [
            (f"{row.printer_name}:jobs", row.jobs) for row in rows
        ] + [(f"{row.printer_name}:failures", row.failures) for row in rows])
    return report


@router.get("/discounted-job-orders/page", response_model=DiscountedJobOrderPageRead)
def get_discounted_job_orders(
    start_date: date = Query(...),
    end_date: date = Query(...),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
) -> DiscountedJobOrderPageRead:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="Report end date must be on or after its start date.")
    query_start, query_end = _utc_query_bounds(start_date, end_date, timezone_offset_minutes)
    query = db.query(JobOrder).outerjoin(Customer).filter(
        JobOrder.created_at >= query_start,
        JobOrder.created_at < query_end,
        JobOrder.discount_amount > 0,
    )
    if term := (search or "").strip():
        match = f"%{term}%"
        query = query.filter(or_(JobOrder.number.ilike(match), JobOrder.name.ilike(match), Customer.display_name.ilike(match)))
    totals = query.with_entities(
        func.coalesce(func.sum(JobOrder.total + JobOrder.discount_amount), 0),
        func.coalesce(func.sum(JobOrder.discount_amount), 0),
        func.coalesce(func.sum(JobOrder.total), 0),
    ).one()
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    jobs = query.order_by(JobOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return DiscountedJobOrderPageRead(
        items=[DiscountedJobOrderRead(
            id=job.id, number=job.number, name=job.name,
            customer_name=job.customer.display_name if job.customer else None,
            status=job.status.value, created_at=job.created_at,
            subtotal=round(job.total + job.discount_amount, 2),
            discount_name=job.discount_name or "Order discount",
            discount_calculation_type=job.discount_calculation_type or "fixed",
            discount_value=job.discount_value or 0,
            discount_amount=job.discount_amount, total=job.total,
        ) for job in jobs],
        page=page, page_size=page_size, total=total, total_pages=total_pages,
        has_next=page < total_pages, has_previous=page > 1,
        subtotal_amount=round(float(totals[0]), 2),
        total_discount_amount=round(float(totals[1]), 2),
        final_amount=round(float(totals[2]), 2),
    )


@router.get("", response_model=OperationalReportRead)
def get_operational_report(
    start_date: date = Query(...),
    end_date: date = Query(...),
    period: ReportPeriod = Query(default="custom"),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
) -> OperationalReportRead:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="Report end date must be on or after its start date.")
    query_start, query_end = _utc_query_bounds(start_date, end_date, timezone_offset_minutes)
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
        db.query(PrintFailure, JobOrderItem, Product)
        .join(JobOrderItem, PrintFailure.job_order_item_id == JobOrderItem.id)
        .join(Product, JobOrderItem.product_id == Product.id)
        .filter(
            PrintFailure.source == "quality_rejected",
            PrintFailure.occurred_at >= query_start,
            PrintFailure.occurred_at < query_end,
        )
        .order_by(PrintFailure.occurred_at)
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
        period_start=start_date,
        period_end=end_date,
        generated_at=generated_at,
        sales=sales,
        re_attempts=re_attempts,
        inventory=inventory,
    )
