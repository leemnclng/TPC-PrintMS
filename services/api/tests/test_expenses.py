from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import InventoryStockPurchase
from app.db.session import get_db
from app.routers import expenses


def _client(tmp_path) -> tuple[TestClient, dict[str, str], sessionmaker]:
    engine = create_engine(f"sqlite:///{tmp_path / 'expenses.db'}", connect_args={"check_same_thread": False})
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        with test_session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(expenses.router)
    return TestClient(app), {"X-Print-MS-Token": settings.token}, test_session


def test_expense_ledger_combines_manual_and_stock_costs(tmp_path) -> None:
    client, headers, test_session = _client(tmp_path)
    today = date.today()
    with test_session() as db:
        db.add(InventoryStockPurchase(
            inventory_item_id=None,
            material_name="A4 Paper",
            purchase_unit="ream",
            quantity_purchased=2,
            sheets_per_ream=500,
            total_cost=420,
            supplier="Paper Depot",
            purchased_on=today,
        ))
        db.commit()

    created = client.post("/expenses", headers=headers, json={
        "category": "Utilities",
        "description": "Electric bill",
        "amount": 1250.5,
        "paidTo": "Power company",
        "spentOn": today.isoformat(),
    })
    assert created.status_code == 201

    ledger = client.get(
        f"/expenses?start_date={today.isoformat()}&end_date={today.isoformat()}",
        headers=headers,
    )
    assert ledger.status_code == 200
    body = ledger.json()
    assert body["entryCount"] == 2
    assert body["totalAmount"] == 1670.5
    assert body["manualExpenseTotal"] == 1250.5
    assert body["stockPurchaseTotal"] == 420
    assert {entry["source"] for entry in body["entries"]} == {"manual", "stock_purchase"}
    assert body["availableCategories"] == ["Stock purchase", "Utilities"]
    page = client.get(
        f"/expenses/page?start_date={today.isoformat()}&end_date={today.isoformat()}&page_size=10",
        headers=headers,
    )
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 2
    assert page.json()["totalAmount"] == 1670.5


def test_expense_filters_and_manual_lifecycle(tmp_path) -> None:
    client, headers, _ = _client(tmp_path)
    today = date.today()
    yesterday = today - timedelta(days=1)
    payload = {
        "category": "Repairs",
        "description": "Printer service",
        "amount": 800,
        "reference": "OR-123",
        "spentOn": yesterday.isoformat(),
    }
    expense = client.post("/expenses", headers=headers, json=payload).json()

    filtered = client.get(
        f"/expenses?start_date={yesterday.isoformat()}&end_date={today.isoformat()}&source=manual&category=Repairs&q=service",
        headers=headers,
    ).json()
    assert filtered["entryCount"] == 1

    payload.update({"description": "Print-head service", "amount": 950})
    updated = client.put(f"/expenses/{expense['id']}", headers=headers, json=payload)
    assert updated.status_code == 200
    assert updated.json()["amount"] == 950

    assert client.delete(f"/expenses/{expense['id']}", headers=headers).status_code == 204
    empty = client.get(
        f"/expenses?start_date={yesterday.isoformat()}&end_date={today.isoformat()}",
        headers=headers,
    ).json()
    assert empty["entryCount"] == 0


def test_expense_validation_rejects_invalid_dates_and_amounts(tmp_path) -> None:
    client, headers, _ = _client(tmp_path)
    today = date.today()
    future = today + timedelta(days=1)
    invalid = client.post("/expenses", headers=headers, json={
        "category": "Other",
        "description": "Future expense",
        "amount": 1.001,
        "spentOn": future.isoformat(),
    })
    assert invalid.status_code == 422
    reserved = client.post("/expenses", headers=headers, json={
        "category": "stock purchase",
        "description": "Duplicate material cost",
        "amount": 10,
        "spentOn": today.isoformat(),
    })
    assert reserved.status_code == 422
    backwards = client.get(
        f"/expenses?start_date={today.isoformat()}&end_date={(today - timedelta(days=1)).isoformat()}",
        headers=headers,
    )
    assert backwards.status_code == 422
