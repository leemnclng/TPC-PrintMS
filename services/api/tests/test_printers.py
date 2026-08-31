from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from PIL import Image

from app.core.config import settings
from app.db.base import Base
from app.db.models import JobOrder, JobOrderItem, JobOrderStatus, ObservedPrintJob, Printer, PrintJob, PrintResult
from app.db.session import get_db
from app.routers import printers
from app.services.printing.adapter import (
    CupsPrinterAdapter,
    DetectedPrinter,
    PrintSubmissionError,
    WindowsPrinterAdapter,
    _prepare_windows_print_pass,
)
from app.services.printing.spooler_monitor import ingest_spooler_event


def test_windows_adapter_reads_vendor_neutral_spooler_queues(monkeypatch) -> None:
    payload = [
        {"Name": "Canon G4770 series", "Default": True, "WorkOffline": False, "PrinterStatus": 3},
        {"Name": "Brother Office", "Default": False, "WorkOffline": False, "PrinterStatus": 4},
        {"Name": "Epson Backup", "Default": False, "WorkOffline": True, "PrinterStatus": 3},
    ]

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess([], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    detected = WindowsPrinterAdapter().list_printers()

    assert [(item.display_name, item.state) for item in detected] == [
        ("Canon G4770 series", "idle"),
        ("Brother Office", "printing"),
        ("Epson Backup", "offline"),
    ]
    assert detected[0].is_default is True


def test_cups_adapter_sends_photo_media_profile(tmp_path, monkeypatch) -> None:
    image = tmp_path / "photo.png"
    image.write_bytes(b"photo")
    captured: dict[str, object] = {}

    def fake_run(command, **_kwargs):
        captured["command"] = command
        return subprocess.CompletedProcess(command, 0, stdout="request id is Canon-9", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    submission = CupsPrinterAdapter().submit_file(
        "Canon_G4070_series",
        image,
        copies=1,
        color_mode="color",
        media_size="A4",
        media_type="photo_plus_glossy_ii",
        quality="high",
        borderless=True,
    )

    command = captured["command"]
    assert isinstance(command, list)
    assert "media=iso_a4_210x297mm.Borderless" in command
    assert "media-type=photographic-high-gloss" in command
    assert "print-quality=5" in command
    assert submission.external_job_id == "Canon-9"


def test_windows_adapter_submits_file_through_selected_queue(tmp_path, monkeypatch) -> None:
    document = tmp_path / "approved file.pdf"
    pdf = pymupdf.open()
    page = pdf.new_page(width=595, height=842)
    page.insert_text((72, 72), "Printing-MS Windows queue test")
    pdf.save(document)
    pdf.close()
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        image_directory = command[command.index("-ImageDirectory") + 1]
        rendered_pages = sorted(Path(image_directory).glob("page-*.png"))
        captured["rendered_pages"] = [page.read_bytes() for page in rendered_pages]
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    submission = WindowsPrinterAdapter().submit_file(
        "Canon G4770 series",
        document,
        copies=2,
        color_mode="color",
        media_size="A4",
        media_type="photo_plus_glossy_ii",
        orientation="landscape",
        scaling="actual_size",
        quality="high",
        borderless=True,
        collate=False,
        tracking_id="attempt-123",
    )

    command = captured["command"]
    assert isinstance(command, list)
    assert command[0] == "powershell.exe"
    assert "-File" in command
    assert "-ImageDirectory" in command
    assert str(document) not in command
    assert "Canon G4770 series" in command
    assert command[command.index("-Copies") + 1] == "2"
    assert command[command.index("-ColorMode") + 1] == "color"
    assert command[command.index("-MediaSize") + 1] == "A4"
    assert command[command.index("-MediaWidthMm") + 1] == "210.0"
    assert command[command.index("-MediaHeightMm") + 1] == "297.0"
    assert command[command.index("-MediaType") + 1] == "photo_plus_glossy_ii"
    assert command[command.index("-Orientation") + 1] == "landscape"
    assert command[command.index("-Scaling") + 1] == "actual_size"
    assert command[command.index("-Quality") + 1] == "high"
    assert command[command.index("-Borderless") + 1] == "true"
    assert command[command.index("-Collate") + 1] == "false"
    assert command[command.index("-TrackingId") + 1] == "attempt-123"
    assert len(captured["rendered_pages"]) == 1
    assert submission.external_job_id is None


def test_windows_adapter_rejects_a_format_without_a_local_renderer(tmp_path) -> None:
    document = tmp_path / "customer-file.docx"
    document.write_bytes(b"not-used")

    with pytest.raises(PrintSubmissionError, match="Export this document to PDF"):
        WindowsPrinterAdapter().submit_file(
            "Canon G4770 series",
            document,
            copies=1,
            color_mode="grayscale",
            media_size="Letter",
        )


def test_windows_print_geometry_uses_printable_area_or_full_borderless_sheet() -> None:
    script = (Path(__file__).parents[1] / "app" / "services" / "printing" / "windows_print.ps1").read_text()

    assert "$document.OriginAtMargins = $false" in script
    assert "$eventArgs.PageSettings.PrintableArea" in script
    assert "$eventArgs.Graphics.TranslateTransform(" in script
    assert "$eventArgs.PageBounds.Width" in script
    assert "$eventArgs.PageBounds.Height" in script
    assert "does not expose borderless printing" not in script
    assert "PageBounds.Width - (2 * $originX)" not in script
    assert "PageBounds.Height - (2 * $originY)" not in script
    assert 'ValidateSet("auto", "fit", "fill", "actual_size")' in script
    assert "$MediaWidthMm" in script
    assert "$MediaHeightMm" in script
    assert "DMMEDIA_GLOSSY" in script


def test_spooler_monitor_persists_external_jobs_and_links_internal_attempts(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'spooler.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    external_event = {
        "eventType": "seen",
        "spoolerKey": "Canon G4770 series, 41|2026-08-29T01:02:03Z",
        "osJobId": "41",
        "printerName": "Canon G4770 series",
        "documentName": "walk-in-form.pdf",
        "owner": "Nicole-Lee",
        "driverName": "Canon G4070 series",
        "totalPages": 3,
        "pagesPrinted": 1,
        "sizeBytes": 4096,
        "status": "OK",
        "jobStatus": "Printing",
        "submittedAt": "2026-08-29T01:02:03Z",
    }

    with test_session() as db:
        ingest_spooler_event(external_event, db)
        observed = db.query(ObservedPrintJob).one()
        assert observed.document_name == "walk-in-form.pdf"
        assert observed.status == "printing"
        assert observed.pages_printed == 1

        ingest_spooler_event(
            {
                "eventType": "released",
                "spoolerKey": external_event["spoolerKey"],
                "osJobId": "41",
            },
            db,
        )
        db.refresh(observed)
        assert observed.status == "released"
        assert observed.released_at is not None

        attempt = PrintJob(job_order_id="job-1", printer_id="printer-1")
        db.add(attempt)
        db.commit()
        ingest_spooler_event(
            {
                **external_event,
                "spoolerKey": "Canon G4770 series, 42|2026-08-29T01:03:03Z",
                "osJobId": "42",
                "documentName": f"Printing-MS|{attempt.id}|approved.pdf",
            },
            db,
        )
        db.refresh(attempt)
        assert attempt.external_job_id == "42"
        assert attempt.spooler_status == "printing"
        assert attempt.spooler_pages_printed == 1
        assert attempt.spooler_total_pages == 3
        assert attempt.spooler_key == "Canon G4770 series, 42|2026-08-29T01:03:03Z"
        ingest_spooler_event(
            {
                "eventType": "released",
                "spoolerKey": attempt.spooler_key,
                "osJobId": "42",
            },
            db,
        )
        db.refresh(attempt)
        assert attempt.spooler_status == "released"
        assert attempt.spooler_released_at is not None
        assert db.query(ObservedPrintJob).count() == 1


def test_windows_spooler_monitor_emits_seen_and_released_events() -> None:
    script = (Path(__file__).parents[1] / "app" / "services" / "printing" / "windows_spooler_monitor.ps1").read_text()

    assert "Get-CimInstance -ClassName Win32_PrintJob" in script
    assert 'Write-JobEvent -EventType "seen"' in script
    assert 'Write-JobEvent -EventType "released"' in script


def test_windows_manual_duplex_pass_preserves_physical_stack_order(tmp_path) -> None:
    colors = [(10, 0, 0), (20, 0, 0), (30, 0, 0), (40, 0, 0), (50, 0, 0)]
    for index, color in enumerate(colors, start=1):
        Image.new("RGB", (40, 60), color).save(tmp_path / f"page-{index:05d}.png", dpi=(300, 300))

    front_directory, front_count = _prepare_windows_print_pass(tmp_path, 5, "front")
    back_directory, back_count = _prepare_windows_print_pass(tmp_path, 5, "back")

    def red_values(directory: Path) -> list[int]:
        values = []
        for path in sorted(directory.glob("page-*.png")):
            with Image.open(path) as image:
                values.append(image.getpixel((0, 0))[0])
        return values

    assert front_count == 3
    assert red_values(front_directory) == [10, 30, 50]
    assert back_count == 3
    assert red_values(back_directory) == [255, 40, 20]


def test_spooler_jobs_endpoint_returns_persisted_external_activity(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'spooler-api.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    with test_session() as db:
        db.add(
            ObservedPrintJob(
                spooler_key="Canon G4770 series, 51|submitted",
                os_job_id="51",
                printer_name="Canon G4770 series",
                document_name="canon-print-photo.jpg",
                status="printing",
                first_seen_at=datetime(2026, 8, 29, 1, 2, 3),
                last_seen_at=datetime(2026, 8, 29, 1, 2, 4),
            )
        )
        db.commit()

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(printers.router)
    monkeypatch.setattr(printers.settings, "printer_platform", "windows")
    monkeypatch.setattr(
        printers,
        "spooler_monitor",
        SimpleNamespace(active=True, error=None),
    )
    client = TestClient(app)
    response = client.get(
        "/printers/spooler-jobs",
        headers={"X-Print-MS-Token": settings.token},
    )

    assert response.status_code == 200
    assert response.json()["active"] is True
    assert response.json()["jobs"][0]["documentName"] == "canon-print-photo.jpg"
    assert response.json()["jobs"][0]["status"] == "printing"
    assert response.json()["jobs"][0]["reviewStatus"] == "unreviewed"

    observed_id = response.json()["jobs"][0]["id"]
    dismissed = client.post(
        f"/printers/spooler-jobs/{observed_id}/dismiss",
        headers={"X-Print-MS-Token": settings.token},
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["jobs"][0]["reviewStatus"] == "dismissed"
    assert dismissed.json()["jobs"][0]["reviewedAt"] is not None


def test_print_activity_returns_queued_and_attention_jobs(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'print-activity.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    with test_session() as db:
        printer = Printer(system_name="Canon queue", display_name="Canon G4770 series")
        ready = JobOrder(name="Ready thesis", number="JOB-0000000001", status=JobOrderStatus.queued, total=10)
        printing = JobOrder(name="Color invitations", number="JOB-0000000002", status=JobOrderStatus.printing, total=20)
        # A scan job also sits in `queued` while awaiting acquisition; it never
        # touches a printer, so it must surface with its own "awaiting_scan"
        # state rather than defaulting to the print-only "ready" ("Ready to
        # print") the generic query used to produce for it.
        scanning = JobOrder(name="Reyes contract scan", number="JOB-0000000003", status=JobOrderStatus.queued, total=0)
        db.add_all([printer, ready, printing, scanning])
        db.flush()
        db.add(JobOrderItem(job_order_id=scanning.id, product_id="scan-product", operation_kind="scan"))
        db.add(
            PrintJob(
                job_order_id=printing.id,
                printer_id=printer.id,
                result=PrintResult.succeeded,
                spooler_status="released",
                spooler_released_at=datetime(2026, 8, 29, 2, 0, 0),
                spooler_pages_printed=3,
                spooler_total_pages=3,
            )
        )
        db.commit()

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(printers.router)
    client = TestClient(app)
    response = client.get("/printers/print-activity", headers={"X-Print-MS-Token": settings.token})

    assert response.status_code == 200
    jobs = response.json()["jobs"]
    job_numbers = [job["jobNumber"] for job in jobs]
    # The attention item always sorts first; "ready" and "awaiting_scan" tie on
    # both sort keys (no attention, no submission), so only their pair — not a
    # specific order between them — is guaranteed.
    assert job_numbers[0] == "JOB-0000000002"
    assert set(job_numbers[1:]) == {"JOB-0000000001", "JOB-0000000003"}
    assert jobs[0]["state"] == "released"
    assert jobs[0]["jobName"] == "Color invitations"
    assert jobs[0]["attentionRequired"] is True
    assert jobs[0]["pagesPrinted"] == 3
    ready_job = next(job for job in jobs if job["jobNumber"] == "JOB-0000000001")
    assert ready_job["state"] == "ready"
    assert ready_job["attentionRequired"] is False
    scan_job = next(job for job in jobs if job["jobNumber"] == "JOB-0000000003")
    assert scan_job["state"] == "awaiting_scan"
    assert scan_job["attentionRequired"] is False
    assert scan_job["printerName"] is None
    assert scan_job["filename"] is None


def test_discovery_reconciles_connected_and_removed_queues(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'printers.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    with test_session() as db:
        db.add(
            Printer(
                system_name="Old queue",
                display_name="Old queue",
                is_default=True,
                last_seen_state="idle",
            )
        )
        db.commit()

    class StubAdapter:
        def list_printers(self):
            return [
                DetectedPrinter(
                    system_name="Canon G4770 series",
                    display_name="Canon G4770 series",
                    is_default=True,
                    state="idle",
                )
            ]

    monkeypatch.setattr(printers, "get_printer_adapter", lambda _platform: StubAdapter())

    def override_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(printers.router)
    client = TestClient(app)
    platform_response = client.get(
        "/printers/platform",
        headers={"X-Print-MS-Token": settings.token},
    )
    response = client.post(
        "/printers/discover",
        headers={"X-Print-MS-Token": settings.token},
    )

    assert platform_response.status_code == 200
    assert platform_response.json()["platform"] in {"windows", "macos", "linux"}
    assert platform_response.json()["detectionSource"] in {"automatic", "environment"}
    assert response.status_code == 200
    by_name = {item["displayName"]: item for item in response.json()}
    assert by_name["Canon G4770 series"]["lastSeenState"] == "idle"
    assert by_name["Canon G4770 series"]["isDefault"] is True
    assert by_name["Old queue"]["lastSeenState"] == "offline"
    assert by_name["Old queue"]["isDefault"] is False
