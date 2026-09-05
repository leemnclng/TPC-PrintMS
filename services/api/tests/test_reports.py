from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import (
    InventoryItem,
    JobOrder,
    JobOrderItem,
    JobOrderItemStatusEvent,
    JobOrderStatus,
    Payment,
    PaymentMethod,
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
            Payment(job_order=prior_order, amount=50, method=PaymentMethod.cash, verified=True, recorded_at=datetime(2026, 8, 31, 8, 0)),
            Payment(job_order=first_order, amount=999, method=PaymentMethod.cash, verified=False, recorded_at=datetime(2026, 9, 3, 3, 0)),
            JobOrderItemStatusEvent(
                job_order_item=item,
                from_status="ready",
                to_status="queued",
                note="Quality failed",
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
        "/reports?period=daily&anchor_date=2026-09-03&timezone_offset_minutes=-480",
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
        "/reports?period=weekly&anchor_date=2026-09-03&timezone_offset_minutes=-480",
        headers=headers,
    ).json()
    assert weekly["periodStart"] == "2026-08-31"
    assert weekly["periodEnd"] == "2026-09-06"
    assert weekly["sales"]["totalSales"] == 300

    monthly = client.get(
        "/reports?period=monthly&anchor_date=2026-09-03&timezone_offset_minutes=-480",
        headers=headers,
    ).json()
    assert monthly["periodStart"] == "2026-09-01"
    assert monthly["periodEnd"] == "2026-09-30"
    assert monthly["sales"]["totalSales"] == 250


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

    assert client.get("/reports?period=yearly&anchor_date=2026-09-03", headers=headers).status_code == 422
    assert client.get("/reports?period=daily&anchor_date=2026-09-03&timezone_offset_minutes=900", headers=headers).status_code == 422
