"""Persistent Windows print-spooler observation.

The monitor records jobs created by any Windows application while Printing-MS
is running. It deliberately labels disappearance as ``released`` rather than
``completed`` because the spooler cannot prove that paper physically exited
the printer.
"""

from __future__ import annotations

import json
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from ...db.models import ObservedPrintJob, PrintJob
from ...db.session import SessionLocal

_INTERNAL_PREFIX = "Printing-MS|"


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _as_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(UTC).replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return None


def _normalized_status(event: dict[str, Any]) -> str:
    if event.get("eventType") == "released":
        return "released"
    raw = f"{event.get('jobStatus') or ''} {event.get('status') or ''}".lower()
    if any(value in raw for value in ("error", "offline", "paper out", "blocked")):
        return "error"
    if "paused" in raw:
        return "paused"
    if "printing" in raw:
        return "printing"
    if "spooling" in raw:
        return "spooling"
    return "queued"


def _internal_attempt_id(document_name: str) -> str | None:
    if not document_name.startswith(_INTERNAL_PREFIX):
        return None
    parts = document_name.split("|", 2)
    return parts[1] if len(parts) == 3 and parts[1] else None


def ingest_spooler_event(event: dict[str, Any], db: Session) -> None:
    spooler_key = str(event.get("spoolerKey") or "").strip()
    if not spooler_key:
        return
    document_name = str(event.get("documentName") or "Untitled document").strip()
    attempt_id = _internal_attempt_id(document_name)
    attempt = db.get(PrintJob, attempt_id) if attempt_id else None
    if attempt is None and event.get("eventType") == "released":
        attempt = db.query(PrintJob).filter_by(spooler_key=spooler_key).one_or_none()
    if attempt:
        now = datetime.now(UTC).replace(tzinfo=None)
        attempt.spooler_key = spooler_key
        attempt.spooler_status = _normalized_status(event)
        attempt.spooler_last_seen_at = now
        pages_printed = _as_int(event.get("pagesPrinted"))
        total_pages = _as_int(event.get("totalPages"))
        if pages_printed is not None:
            attempt.spooler_pages_printed = pages_printed
        if total_pages is not None:
            attempt.spooler_total_pages = total_pages
        if event.get("eventType") == "released":
            attempt.spooler_released_at = now
        elif event.get("osJobId"):
            attempt.external_job_id = str(event["osJobId"])
            attempt.spooler_released_at = None
        db.commit()
        return

    now = datetime.now(UTC).replace(tzinfo=None)
    observed = db.query(ObservedPrintJob).filter_by(spooler_key=spooler_key).one_or_none()
    if event.get("eventType") == "released":
        if observed:
            observed.status = "released"
            observed.last_seen_at = now
            observed.released_at = now
            db.commit()
        return

    if observed is None:
        observed = ObservedPrintJob(
            spooler_key=spooler_key,
            os_job_id=str(event.get("osJobId") or "unknown"),
            printer_name=str(event.get("printerName") or "Unknown Windows printer"),
            document_name=document_name or "Untitled document",
            first_seen_at=now,
        )
        db.add(observed)

    observed.os_job_id = str(event.get("osJobId") or observed.os_job_id)
    observed.printer_name = str(event.get("printerName") or observed.printer_name)
    observed.document_name = document_name or observed.document_name
    observed.owner = str(event["owner"]) if event.get("owner") else None
    observed.driver_name = str(event["driverName"]) if event.get("driverName") else None
    observed.total_pages = _as_int(event.get("totalPages"))
    observed.pages_printed = _as_int(event.get("pagesPrinted"))
    observed.size_bytes = _as_int(event.get("sizeBytes"))
    observed.status = _normalized_status(event)
    observed.raw_status = str(event.get("jobStatus") or event.get("status") or "") or None
    observed.submitted_at = _as_datetime(event.get("submittedAt"))
    observed.last_seen_at = now
    observed.released_at = None
    db.commit()


class WindowsSpoolerMonitor:
    def __init__(self, session_factory: sessionmaker = SessionLocal) -> None:
        self._session_factory = session_factory
        self._process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._active = False
        self._error: str | None = None

    @property
    def active(self) -> bool:
        with self._lock:
            return self._active

    @property
    def error(self) -> str | None:
        with self._lock:
            return self._error

    def start(self) -> None:
        if self.active:
            return
        script = Path(__file__).with_name("windows_spooler_monitor.ps1")
        command = [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
        ]
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as error:
            with self._lock:
                self._error = f"Windows spooler monitor could not start: {error}"
            return
        with self._lock:
            self._process = process
            self._active = True
            self._error = None
        self._thread = threading.Thread(target=self._read_events, daemon=True, name="windows-spooler-monitor")
        self._thread.start()

    def _read_events(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        try:
            for line in process.stdout:
                try:
                    event = json.loads(line)
                    with self._session_factory() as db:
                        ingest_spooler_event(event, db)
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
                except Exception as error:  # keep observing after one persistence failure
                    with self._lock:
                        self._error = f"A Windows print event could not be saved: {error}"
        finally:
            stderr = process.stderr.read().strip() if process.stderr else ""
            return_code = process.poll()
            with self._lock:
                self._active = False
                if return_code not in (None, 0) and stderr:
                    self._error = stderr.splitlines()[0][:500]

    def stop(self) -> None:
        with self._lock:
            process = self._process
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        with self._lock:
            self._active = False
            self._process = None


spooler_monitor = WindowsSpoolerMonitor()
