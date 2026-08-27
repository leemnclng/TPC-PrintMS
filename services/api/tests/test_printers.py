from __future__ import annotations

import json
import subprocess

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import Printer
from app.db.session import get_db
from app.routers import printers
from app.services.printing.adapter import DetectedPrinter, WindowsPrinterAdapter


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


def test_windows_adapter_submits_file_through_selected_queue(tmp_path, monkeypatch) -> None:
    document = tmp_path / "approved file.pdf"
    document.write_bytes(b"%PDF-test")
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    submission = WindowsPrinterAdapter().submit_file(
        "Canon G4770 series",
        document,
        copies=2,
        color_mode="color",
        media_size="A4",
    )

    command = captured["command"]
    assert isinstance(command, list)
    assert command[0] == "powershell.exe"
    assert "-File" in command
    assert str(document) in command
    assert "Canon G4770 series" in command
    assert command[-1] == "2"
    assert submission.external_job_id is None


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
