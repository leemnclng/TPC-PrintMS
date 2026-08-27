from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..core.config import settings
from ..db.models import Printer
from ..db.session import get_db
from ..schemas.printers import PrinterPlatformRead, PrinterRead
from ..services.printing.adapter import get_printer_adapter

router = APIRouter(prefix="/printers", tags=["printers"], dependencies=[Depends(require_token)])


@router.get("/platform", response_model=PrinterPlatformRead)
def get_printer_platform() -> PrinterPlatformRead:
    platform_name = settings.resolved_printer_platform
    return PrinterPlatformRead(
        platform=platform_name,
        configured_platform=settings.printer_platform,
        detection_source=settings.printer_platform_source,
        adapter="windows_spooler" if platform_name == "windows" else "cups",
    )


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
