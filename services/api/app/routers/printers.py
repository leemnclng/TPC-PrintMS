from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, exists
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..core.config import settings
from ..db.models import JobOrder, JobOrderItem, JobOrderStatus, ObservedPrintJob, Printer, PrintResult
from ..db.session import get_db
from ..schemas.printers import PrintActivityJobRead, PrintActivityRead, PrinterPlatformRead, PrinterRead, SpoolerMonitorRead
from ..services.printing.adapter import get_printer_adapter
from ..services.printing.spooler_monitor import spooler_monitor

router = APIRouter(prefix="/printers", tags=["printers"], dependencies=[Depends(require_token)])


@router.get("/print-activity", response_model=PrintActivityRead)
def list_print_activity(db: Session = Depends(get_db)) -> PrintActivityRead:
    """Return every job waiting for or currently moving through a printer.

    A released spooler item intentionally remains an attention state until the
    owner advances the job into the Ready step; spooler release is not proof
    that the physical sheet exited successfully.
    """
    # Scan jobs also sit in `queued` while awaiting acquisition, but they never
    # touch a printer — without this filter they showed up here defaulting to
    # state "ready" ("Ready to print"), even though nothing was ever printed.
    # Excluding by non-existence (rather than joining/requiring a "printing"
    # item) keeps an item-less job order — never produced outside tests, but
    # not ruled out by the schema either — treated as printing by default.
    orders = (
        db.query(JobOrder)
        .filter(JobOrder.status.in_([JobOrderStatus.queued, JobOrderStatus.printing]))
        .filter(
            ~exists().where(
                and_(
                    JobOrderItem.job_order_id == JobOrder.id,
                    JobOrderItem.operation_kind != "printing",
                )
            )
        )
        .order_by(JobOrder.updated_at.desc())
        .all()
    )
    activity: list[PrintActivityJobRead] = []
    for order in orders:
        attempt = max(order.print_jobs, key=lambda item: item.submitted_at, default=None)
        state = "ready"
        attention_required = False
        if attempt:
            if attempt.result == PrintResult.failed or attempt.spooler_status == "error":
                state = "error"
                attention_required = True
            elif attempt.spooler_status == "paused":
                state = "paused"
                attention_required = True
            elif attempt.spooler_status == "released":
                state = "awaiting_reinsert" if attempt.duplex_pass == "front" else "released"
                attention_required = True
            elif attempt.spooler_status in {"queued", "spooling", "printing"}:
                state = attempt.spooler_status
            else:
                state = "submitted"
        activity.append(
            PrintActivityJobRead(
                job_order_id=order.id,
                job_number=order.number,
                job_name=order.name,
                job_status=order.status.value,
                attempt_id=attempt.id if attempt else None,
                printer_name=attempt.printer.display_name if attempt else None,
                filename=attempt.job_file.original_filename if attempt and attempt.job_file else None,
                state=state,
                pages_printed=attempt.spooler_pages_printed if attempt else None,
                total_pages=attempt.spooler_total_pages if attempt else None,
                duplex_pass=attempt.duplex_pass if attempt else None,
                submitted_at=attempt.submitted_at if attempt else None,
                attention_required=attention_required,
            )
        )
    activity.sort(key=lambda item: (not item.attention_required, item.submitted_at or datetime.min))
    return PrintActivityRead(jobs=activity)


@router.get("/platform", response_model=PrinterPlatformRead)
def get_printer_platform() -> PrinterPlatformRead:
    platform_name = settings.resolved_printer_platform
    return PrinterPlatformRead(
        platform=platform_name,
        configured_platform=settings.printer_platform,
        detection_source=settings.printer_platform_source,
        adapter="windows_spooler" if platform_name == "windows" else "cups",
    )


@router.get("/spooler-jobs", response_model=SpoolerMonitorRead)
def list_spooler_jobs(db: Session = Depends(get_db)) -> SpoolerMonitorRead:
    supported = settings.resolved_printer_platform == "windows"
    jobs = (
        db.query(ObservedPrintJob)
        .order_by(ObservedPrintJob.last_seen_at.desc())
        .limit(50)
        .all()
        if supported
        else []
    )
    if not supported:
        message = "External job monitoring is available on the Windows desktop app."
    elif spooler_monitor.active:
        message = "Watching the Windows spooler while Printing-MS is open."
    elif spooler_monitor.error:
        message = spooler_monitor.error
    else:
        message = "The Windows spooler monitor is starting."
    return SpoolerMonitorRead(
        supported=supported,
        active=spooler_monitor.active,
        message=message,
        jobs=jobs,
    )


@router.post("/spooler-jobs/{observed_job_id}/dismiss", response_model=SpoolerMonitorRead)
def dismiss_spooler_job(observed_job_id: str, db: Session = Depends(get_db)) -> SpoolerMonitorRead:
    observed = db.get(ObservedPrintJob, observed_job_id)
    if not observed:
        raise HTTPException(status_code=404, detail="Observed Windows print job not found.")
    if observed.review_status == "linked":
        raise HTTPException(status_code=409, detail="This Windows print job is already linked to a job order.")
    observed.review_status = "dismissed"
    observed.reviewed_at = datetime.utcnow()
    db.commit()
    return list_spooler_jobs(db)


@router.get("", response_model=list[PrinterRead])
def list_printers(db: Session = Depends(get_db)) -> list[Printer]:
    return db.query(Printer).order_by(Printer.display_name).all()


@router.post("/discover", response_model=list[PrinterRead])
def discover_printers(db: Session = Depends(get_db)) -> list[Printer]:
    """Re-reads the OS print queue (CUPS `lpstat` on macOS/Linux) and
    reconciles it with the stored printer list. This is a real detection
    pass, not a mock — see docs/context/build-plan.md Phase 1."""
    adapter = get_printer_adapter(settings.resolved_printer_platform)
    detected = adapter.list_printers()

    seen_names = set()
    for item in detected:
        seen_names.add(item.system_name)
        existing = db.query(Printer).filter_by(system_name=item.system_name).one_or_none()
        if existing:
            existing.display_name = item.display_name
            existing.is_default = item.is_default
            existing.last_seen_state = item.state
            existing.last_seen_at = datetime.utcnow()
        else:
            db.add(
                Printer(
                    system_name=item.system_name,
                    display_name=item.display_name,
                    is_default=item.is_default,
                    last_seen_state=item.state,
                )
            )

    # Preserve the historical record, but never leave a removed/disconnected
    # queue looking healthy after a successful discovery pass.
    for existing in db.query(Printer).all():
        if existing.system_name not in seen_names:
            existing.is_default = False
            existing.last_seen_state = "offline"
    db.commit()
    return db.query(Printer).order_by(Printer.display_name).all()
