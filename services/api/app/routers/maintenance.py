from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import MaintenanceReminder
from ..db.session import get_db
from ..schemas.maintenance import MaintenanceReminderCreate, MaintenanceReminderRead, MaintenanceReminderUpdate

router = APIRouter(
    prefix="/maintenance-reminders",
    tags=["maintenance"],
    dependencies=[Depends(require_token)],
)


@router.get("", response_model=list[MaintenanceReminderRead])
def list_reminders(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[MaintenanceReminder]:
    query = db.query(MaintenanceReminder)
    if active_only:
        query = query.filter(MaintenanceReminder.is_active.is_(True))
    return query.order_by(MaintenanceReminder.created_at, MaintenanceReminder.id).all()


@router.post("", response_model=MaintenanceReminderRead, status_code=201)
def create_reminder(
    payload: MaintenanceReminderCreate,
    db: Session = Depends(get_db),
) -> MaintenanceReminder:
    reminder = MaintenanceReminder(**payload.model_dump())
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def _get_reminder(reminder_id: str, db: Session) -> MaintenanceReminder:
    reminder = db.get(MaintenanceReminder, reminder_id)
    if not reminder:
        raise HTTPException(status_code=404, detail="Maintenance reminder not found.")
    return reminder


@router.put("/{reminder_id}", response_model=MaintenanceReminderRead)
def update_reminder(
    reminder_id: str,
    payload: MaintenanceReminderUpdate,
    db: Session = Depends(get_db),
) -> MaintenanceReminder:
    reminder = _get_reminder(reminder_id, db)
    reminder.message = payload.message
    reminder.is_active = payload.is_active
    db.commit()
    db.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: str, db: Session = Depends(get_db)) -> None:
    reminder = _get_reminder(reminder_id, db)
    db.delete(reminder)
    db.commit()
