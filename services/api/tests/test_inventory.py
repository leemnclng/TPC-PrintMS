from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.modules.document_analyzer.api import router as document_analyzer_router
from app.routers import inventory, products, services


def test_inventory_stock_ledger_and_product_assignments(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'inventory.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(services.router)
    app.include_router(products.router)
    app.include_router(inventory.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    inventory_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Short paper",
            "category": "Paper",
            "unit": "sheet",
            "openingQuantity": 500,
            "reorderLevel": 100,
            "isActive": True,
        },
    )
    assert inventory_response.status_code == 201
    inventory_item = inventory_response.json()
    assert inventory_item["quantityOnHand"] == 500
    assert inventory_item["linkedProductCount"] == 0

    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Printing", "description": None, "isActive": True},
    ).json()
    product_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Black and white photocopy",
            "description": None,
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": inventory_item["id"]}],
        },
    )
    assert product_response.status_code == 201
    product = product_response.json()
    assert product["printType"] == "black_and_white"
    assert product["materialAssignments"][0]["inventoryItemName"] == "Short paper"
    assert product["materialAssignments"][0]["inventoryItemUnit"] == "sheet"

    listed_item = client.get("/inventory-items", headers=headers).json()[0]
    assert listed_item["linkedProductCount"] == 1

    adjustment_response = client.post(
        f"/inventory-items/{inventory_item['id']}/adjustments",
        headers=headers,
        json={"quantityDelta": -25, "kind": "stock_out", "note": "Damaged sheets"},
    )
    assert adjustment_response.status_code == 201
    assert adjustment_response.json()["balanceAfter"] == 475

    movements = client.get(
        "/inventory-movements",
        headers=headers,
        params={"inventory_item_id": inventory_item["id"]},
    ).json()
    assert [movement["kind"] for movement in movements] == ["stock_out", "opening_balance"]

    negative_balance = client.post(
        f"/inventory-items/{inventory_item['id']}/adjustments",
        headers=headers,
        json={"quantityDelta": -500, "kind": "stock_out"},
    )
    assert negative_balance.status_code == 409


def test_inventory_item_deletion_guards(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'inventory-delete.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)

    def override_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(services.router)
    app.include_router(products.router)
    app.include_router(inventory.router)
    app.include_router(document_analyzer_router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    linked_item = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Card stock",
            "category": "Paper",
            "unit": "sheet",
            "openingQuantity": 100,
            "reorderLevel": 10,
            "isActive": True,
        },
    ).json()
    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Printing", "description": None, "isActive": True},
    ).json()
    product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Business cards",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": linked_item["id"]}],
        },
    ).json()

    blocked_by_assignment = client.delete(f"/inventory-items/{linked_item['id']}", headers=headers)
    assert blocked_by_assignment.status_code == 409

    assert client.delete(f"/products/{product['id']}", headers=headers).status_code == 204

    # Recorded stock movements (its opening balance, here) no longer block
    # deletion once nothing else references the item — they're deleted
    # along with it.
    unblocked_response = client.delete(f"/inventory-items/{linked_item['id']}", headers=headers)
    assert unblocked_response.status_code == 204
    assert client.get(f"/inventory-items/{linked_item['id']}", headers=headers).status_code == 404

    unused_item = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Unused stock",
            "category": "Paper",
            "unit": "sheet",
            "openingQuantity": 0,
            "reorderLevel": 0,
            "isActive": True,
        },
    ).json()
    deleted_response = client.delete(f"/inventory-items/{unused_item['id']}", headers=headers)
    assert deleted_response.status_code == 204
    assert client.get(f"/inventory-items/{unused_item['id']}", headers=headers).status_code == 404

    # A material referenced by a document-analyzer pricing rule still can't
    # be deleted, even with no product assignment or movement history.
    paper_item = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Legal Bond Paper",
            "category": "Paper",
            "unit": "sheet",
            "openingQuantity": 0,
            "reorderLevel": 0,
            "paperSize": "Legal",
            "isActive": True,
        },
    ).json()
    assert client.get("/document-analyzer/pricing-rules", headers=headers).status_code == 200
    blocked_by_pricing_rule = client.delete(f"/inventory-items/{paper_item['id']}", headers=headers)
    assert blocked_by_pricing_rule.status_code == 409

    missing_response = client.delete("/inventory-items/missing", headers=headers)
    assert missing_response.status_code == 404
