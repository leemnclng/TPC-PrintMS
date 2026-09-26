from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import (
    FailureReason,
    InventoryItem,
    JobOrder,
    JobOrderItem,
    JobOrderItemStatusEvent,
    JobOrderStatus,
    ObservedPrintJob,
    Payment,
    PaymentMethod,
    PrintFailure,
    PrintJob,
    PrintResult,
    Printer,
    PrintType,
    Product,
    Service,
)
from app.db.session import get_db
from app.routers import reports


def test_period_reports_use_verified_sales_reprocess_events_and_live_inventory(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'reports.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    with test_session() as db:
        service = Service(name="Printing", category="printing")
        print_type = PrintType(
            key="black_and_white",
            label="B&W",
            color_mode="grayscale",
            applies_ink_coverage=False,
        )
        product = Product(
            service=service,
            print_type_definition=print_type,
            name="Document Print",
            print_type="black_and_white",
            operation_kind="printing",
        )
        first_order = JobOrder(number="JOB-0000000001", name="Daily print", total=200, status=JobOrderStatus.completed)
        second_order = JobOrder(number="JOB-0000000002", name="Daily scan", total=50, status=JobOrderStatus.paid)
        prior_order = JobOrder(number="JOB-0000000003", name="Prior work", total=50, status=JobOrderStatus.completed)
        item = JobOrderItem(
            job_order=first_order,
            product=product,
            operation_kind="printing",
            pages_per_copy=1,
            copies=1,
            unit_price=200,
            line_total=200,
            status="queued",
            reprocess_count=1,
        )
        db.add_all([
            service,
            print_type,
            product,
            first_order,
            second_order,
            prior_order,
            item,
            Payment(job_order=first_order, amount=200, method=PaymentMethod.cash, verified=True, recorded_at=datetime(2026, 9, 2, 16, 0)),
            Payment(job_order=second_order, amount=50, method=PaymentMethod.bank_transfer, verified=True, recorded_at=datetime(2026, 9, 3, 15, 59)),
            Payment(job_order=second_order, amount=75, method=PaymentMethod.cash, verified=True, recorded_at=datetime(2026, 9, 20, 6, 0)),
            Payment(job_order=prior_order, amount=50, method=PaymentMethod.cash, verified=True, recorded_at=datetime(2026, 8, 31, 8, 0)),
            Payment(job_order=first_order, amount=999, method=PaymentMethod.cash, verified=False, recorded_at=datetime(2026, 9, 3, 3, 0)),
            JobOrderItemStatusEvent(
                job_order_item=item,
                from_status="ready",
                to_status="queued",
                note="Quality failed",
                occurred_at=datetime(2026, 9, 3, 4, 0),
            ),
            FailureReason(code="other", label="Other", fault_type="operator"),
            PrintFailure(
                source="quality_rejected",
                job_order=first_order,
                job_order_item=item,
                reason_code="other",
                occurred_at=datetime(2026, 9, 3, 4, 0),
            ),
            InventoryItem(name="Healthy bond", category="Paper", unit="sheet", quantity_on_hand=100, reorder_level=20),
            InventoryItem(name="Low glossy", category="Paper", unit="sheet", quantity_on_hand=5, reorder_level=10),
            InventoryItem(name="Empty ink", category="Ink", unit="bottle", quantity_on_hand=0, reorder_level=1),
            InventoryItem(name="Retired stock", category="Paper", unit="sheet", quantity_on_hand=2, reorder_level=5, is_active=False),
        ])
        db.commit()

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(reports.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    daily_response = client.get(
        "/reports?period=daily&start_date=2026-09-03&end_date=2026-09-03&timezone_offset_minutes=-480",
        headers=headers,
    )
    assert daily_response.status_code == 200, daily_response.text
    daily = daily_response.json()
    assert daily["periodStart"] == "2026-09-03"
    assert daily["periodEnd"] == "2026-09-03"
    assert daily["sales"] == {
        "totalSales": 250.0,
        "transactionCount": 2,
        "verifiedPaymentCount": 2,
        "byPaymentMethod": [
            {"method": "bank_transfer", "amount": 50.0, "paymentCount": 1},
            {"method": "cash", "amount": 200.0, "paymentCount": 1},
        ],
    }
    assert daily["reAttempts"]["totalReAttempts"] == 1
    assert daily["reAttempts"]["affectedJobCount"] == 1
    assert daily["reAttempts"]["byProduct"][0]["productName"] == "Document Print"
    assert daily["inventory"]["activeItemCount"] == 3
    assert daily["inventory"]["inactiveItemCount"] == 1
    assert daily["inventory"]["healthyCount"] == 1
    assert daily["inventory"]["lowStockCount"] == 1
    assert daily["inventory"]["outOfStockCount"] == 1
    assert [item["status"] for item in daily["inventory"]["items"]] == ["out", "low", "healthy"]

    weekly = client.get(
        "/reports?period=weekly&start_date=2026-08-31&end_date=2026-09-06&timezone_offset_minutes=-480",
        headers=headers,
    ).json()
    assert weekly["periodStart"] == "2026-08-31"
    assert weekly["periodEnd"] == "2026-09-06"
    assert weekly["sales"]["totalSales"] == 300

    monthly = client.get(
        "/reports?period=monthly&start_date=2026-09-01&end_date=2026-09-30&timezone_offset_minutes=-480",
        headers=headers,
    ).json()
    assert monthly["periodStart"] == "2026-09-01"
    assert monthly["periodEnd"] == "2026-09-30"
    assert monthly["sales"]["totalSales"] == 325


def test_report_query_rejects_invalid_period_and_timezone(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'invalid-report.db'}")
    test_session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(reports.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    assert client.get("/reports?period=custom", headers=headers).status_code == 422
    assert client.get("/reports?period=yearly&start_date=2026-09-03&end_date=2026-09-03", headers=headers).status_code == 422
    assert client.get("/reports?period=daily&start_date=2026-09-03&end_date=2026-09-03&timezone_offset_minutes=900", headers=headers).status_code == 422
    reversed_interval = client.get(
        "/reports?period=custom&start_date=2026-09-04&end_date=2026-09-03",
        headers=headers,
    )
    assert reversed_interval.status_code == 422
    assert reversed_interval.json()["detail"] == "Report end date must be on or after its start date."


def test_reconciliation_failure_printer_reports_and_csv(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'quality-reports.db'}", connect_args={"check_same_thread": False})
    test_session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "printer_platform", "windows")

    with test_session() as db:
        printer = Printer(system_name="Canon", display_name="Canon G4770", last_seen_state="idle")
        order = JobOrder(number="JOB-0000000099", name="Quality report", total=100)
        reason = FailureReason(code="streaks_banding", label="Streaks / banding", fault_type="machine")
        confirmed = PrintJob(
            job_order=order, printer=printer, result=PrintResult.succeeded,
            color_mode="color", duplex_pass="simplex", spooler_key="confirmed",
            spooler_status="released", spooler_pages_printed=4, spooler_total_pages=4,
            spooler_released_at=datetime(2026, 9, 3, 9), submitted_at=datetime(2026, 9, 3, 8),
        )
        mismatch = PrintJob(
            job_order=order, printer=printer, result=PrintResult.succeeded,
            color_mode="grayscale", duplex_pass="front", spooler_key="mismatch",
            spooler_status="released", spooler_pages_printed=2, spooler_total_pages=3,
            spooler_released_at=datetime(2026, 9, 3, 10), submitted_at=datetime(2026, 9, 3, 9),
        )
        unconfirmed = PrintJob(
            job_order=order, printer=printer, result=PrintResult.succeeded,
            color_mode="grayscale", duplex_pass="simplex", submitted_at=datetime(2026, 9, 3, 10),
        )
        leakage = ObservedPrintJob(
            spooler_key="outside", os_job_id="12", printer_name="Canon G4770",
            document_name="outside.pdf", total_pages=5, pages_printed=5,
            status="released", review_status="unreviewed", first_seen_at=datetime(2026, 9, 3, 11),
            last_seen_at=datetime(2026, 9, 3, 11), released_at=datetime(2026, 9, 3, 11),
        )
        linked = ObservedPrintJob(
            spooler_key="linked", os_job_id="13", printer_name="Canon G4770",
            document_name="linked.pdf", total_pages=2, pages_printed=2,
            status="released", review_status="linked", linked_job_order_id=order.id,
            first_seen_at=datetime(2026, 9, 3, 12), last_seen_at=datetime(2026, 9, 3, 12),
            released_at=datetime(2026, 9, 3, 12),
        )
        failure = PrintFailure(
            source="quality_rejected", job_order=order, print_job=confirmed,
            printer_name="Canon G4770", reason=reason, spoiled_sheets=3,
            material_cost_snapshot=6.0, occurred_at=datetime(2026, 9, 3, 13),
        )
        db.add_all([printer, order, reason, confirmed, mismatch, unconfirmed, leakage, linked, failure])
        db.commit()

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(reports.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}
    query = "start_date=2026-09-03&end_date=2026-09-03"

    reconciliation = client.get(f"/reports/reconciliation?{query}", headers=headers)
    assert reconciliation.status_code == 200, reconciliation.text
    assert reconciliation.json()["billedPrints"] == 3
    assert reconciliation.json()["spoolerConfirmed"] == 2
    assert reconciliation.json()["unconfirmed"] == 1
    assert reconciliation.json()["pageMismatches"] == 1
    assert reconciliation.json()["leakagePages"] == 5
    assert reconciliation.json()["linkedExternalPrints"] == 1
    assert reconciliation.json()["spoolerAvailable"] is True

    failures = client.get(f"/reports/failures?{query}", headers=headers).json()
    assert failures["totalFailures"] == 1
    assert failures["spoiledSheets"] == 3
    assert failures["materialCost"] == 6
    assert failures["byReason"][0]["label"] == "Streaks / banding"

    printers_report = client.get(f"/reports/printers?{query}", headers=headers).json()
    assert printers_report["printers"][0]["jobs"] == 3
    assert printers_report["printers"][0]["failures"] == 1
    assert printers_report["printers"][0]["colorJobs"] == 1

    csv_response = client.get(f"/reports/reconciliation?{query}&format=csv", headers=headers)
    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    assert "billed_prints,3" in csv_response.text
