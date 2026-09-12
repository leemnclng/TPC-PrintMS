from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import Product
from app.db.session import get_db
from app.modules.document_analyzer.api import router as document_analyzer_router
from app.routers import inventory, products, services


def test_canon_paper_catalog_and_custom_measurements(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'paper-catalog.db'}",
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
    app.include_router(inventory.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    catalog = client.get("/paper-sizes", headers=headers)
    assert catalog.status_code == 200
    sizes = catalog.json()
    assert len(sizes) == 31
    assert next(size for size in sizes if size["key"] == "A4") == {
        "key": "A4",
        "label": "A4",
        "widthMm": 210,
        "heightMm": 297,
        "group": "document",
    }
    assert next(size for size in sizes if size["key"] == '4\"x6\"')["widthMm"] == 101.6

    # Canonical named measurements cannot be mismatched by a client.
    a5 = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "A5 bond paper",
            "category": "Paper",
            "unit": "sheet",
            "paperSize": "A5",
            "paperWidthMm": 1,
            "paperHeightMm": 2,
        },
    )
    assert a5.status_code == 201
    assert (a5.json()["paperWidthMm"], a5.json()["paperHeightMm"]) == (148, 210)

    # Different materials may share a physical size and remain separate pricing rows.
    second_a5 = client.post(
        "/inventory-items",
        headers=headers,
        json={"name": "A5 glossy paper", "category": "Paper", "unit": "sheet", "paperSize": "A5"},
    )
    assert second_a5.status_code == 201

    custom = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Panoramic stock",
            "category": "Paper",
            "unit": "sheet",
            "paperSize": "Custom",
            "paperWidthMm": 1200,
            "paperHeightMm": 210,
        },
    )
    assert custom.status_code == 201
    assert (custom.json()["paperWidthMm"], custom.json()["paperHeightMm"]) == (210, 1200)

    invalid_custom = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Oversized stock",
            "category": "Paper",
            "unit": "sheet",
            "paperSize": "Custom",
            "paperWidthMm": 217,
            "paperHeightMm": 300,
        },
    )
    assert invalid_custom.status_code == 422


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
            "purchasePrice": 250,
            "purchasePriceBasis": "ream",
            "sheetsPerReam": 500,
            "isActive": True,
        },
    )
    assert inventory_response.status_code == 201
    inventory_item = inventory_response.json()
    assert inventory_item["quantityOnHand"] == 500
    assert inventory_item["purchasePrice"] == 250
    assert inventory_item["purchasePriceBasis"] == "ream"
    assert inventory_item["sheetsPerReam"] == 500
    assert inventory_item["linkedProductCount"] == 0
    assert inventory_item["stockPurchaseCount"] == 0
    assert inventory_item["availableStockPurchaseCount"] == 0

    ream_purchase_response = client.post(
        "/inventory-stock-purchases",
        headers=headers,
        json={
            "inventoryItemId": inventory_item["id"],
            "quantityPurchased": 2,
            "sheetsPerReam": 100,
            "totalCost": 500,
            "purchasedOn": "2026-09-12",
        },
    )
    assert ream_purchase_response.status_code == 201
    assert ream_purchase_response.json()["purchaseUnit"] == "ream"
    assert ream_purchase_response.json()["sheetsPerReam"] == 100
    assert ream_purchase_response.json()["stockQuantity"] == 200
    assert ream_purchase_response.json()["appliedAt"] is None
    unchanged_ream_item = client.get(
        f"/inventory-items/{inventory_item['id']}", headers=headers
    ).json()
    assert unchanged_ream_item["quantityOnHand"] == 500
    assert unchanged_ream_item["purchasePrice"] == 250

    updated_response = client.put(
        f"/inventory-items/{inventory_item['id']}",
        headers=headers,
        json={
            "name": "Short paper",
            "category": "Paper",
            "unit": "sheet",
            "reorderLevel": 100,
            "purchasePrice": 0.8,
            "purchasePriceBasis": "unit",
            "sheetsPerReam": None,
            "isActive": True,
        },
    )
    assert updated_response.status_code == 200
    assert updated_response.json()["purchasePrice"] == 0.8
    assert updated_response.json()["purchasePriceBasis"] == "unit"
    assert updated_response.json()["sheetsPerReam"] is None

    applied_purchase = client.post(
        f"/inventory-stock-purchases/{ream_purchase_response.json()['id']}/apply",
        headers=headers,
        json={},
    )
    assert applied_purchase.status_code == 201
    assert applied_purchase.json()["quantityDelta"] == 200
    assert applied_purchase.json()["balanceAfter"] == 700
    assert applied_purchase.json()["stockPurchaseId"] == ream_purchase_response.json()["id"]
    assert client.post(
        f"/inventory-stock-purchases/{ream_purchase_response.json()['id']}/apply",
        headers=headers,
        json={},
    ).status_code == 409
    assert client.delete(
        f"/inventory-stock-purchases/{ream_purchase_response.json()['id']}",
        headers=headers,
    ).status_code == 409
    applied_item = client.get(f"/inventory-items/{inventory_item['id']}", headers=headers).json()
    assert applied_item["availableStockPurchaseCount"] == 0

    invalid_cost_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Invalid cost",
            "category": "Paper",
            "unit": "sheet",
            "purchasePrice": -1,
        },
    )
    assert invalid_cost_response.status_code == 422

    unsupported_unit_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Measured ink",
            "category": "Ink",
            "unit": "milliliter",
        },
    )
    assert unsupported_unit_response.status_code == 422

    missing_ream_size_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Unspecified ream",
            "category": "Paper",
            "unit": "sheet",
            "purchasePrice": 250,
            "purchasePriceBasis": "ream",
        },
    )
    assert missing_ream_size_response.status_code == 422

    invalid_ream_unit_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Ink bottle",
            "category": "Ink",
            "unit": "bottle",
            "purchasePrice": 350,
            "purchasePriceBasis": "ream",
            "sheetsPerReam": 500,
        },
    )
    assert invalid_ream_unit_response.status_code == 422

    purchase_item = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Bulk black ink",
            "category": "Ink",
            "unit": "bottle",
            "openingQuantity": 10,
            "purchasePrice": 45,
        },
    ).json()
    future_purchase = client.post(
        "/inventory-stock-purchases",
        headers=headers,
        json={
            "inventoryItemId": purchase_item["id"],
            "quantityPurchased": 5,
            "totalCost": 250,
            "purchasedOn": "2999-01-01",
        },
    )
    assert future_purchase.status_code == 422
    purchase_response = client.post(
        "/inventory-stock-purchases",
        headers=headers,
        json={
            "inventoryItemId": purchase_item["id"],
            "quantityPurchased": 5,
            "totalCost": 250,
            "supplier": "Print Supply Co.",
            "reference": "OR-1042",
            "purchasedOn": "2026-09-12",
        },
    )
    assert purchase_response.status_code == 201
    purchase = purchase_response.json()
    assert purchase["materialName"] == "Bulk black ink"
    assert purchase["quantityPurchased"] == 5
    assert purchase["purchaseUnit"] == "bottle"
    assert purchase["totalCost"] == 250
    assert purchase["unitCost"] == 50
    refreshed_purchase_item = client.get(f"/inventory-items/{purchase_item['id']}", headers=headers).json()
    assert refreshed_purchase_item["quantityOnHand"] == 10
    assert refreshed_purchase_item["purchasePrice"] == 45
    assert refreshed_purchase_item["stockPurchaseCount"] == 1
    assert refreshed_purchase_item["availableStockPurchaseCount"] == 1
    backdated_purchase = client.post(
        "/inventory-stock-purchases",
        headers=headers,
        json={
            "inventoryItemId": purchase_item["id"],
            "quantityPurchased": 1,
            "totalCost": 25,
            "purchasedOn": "2026-01-01",
        },
    )
    assert backdated_purchase.status_code == 201
    unchanged_item = client.get(f"/inventory-items/{purchase_item['id']}", headers=headers).json()
    assert unchanged_item["quantityOnHand"] == 10
    assert unchanged_item["purchasePrice"] == 45
    assert unchanged_item["stockPurchaseCount"] == 2
    purchase_item_movements = client.get(
        f"/inventory-movements?inventory_item_id={purchase_item['id']}", headers=headers
    ).json()
    assert [movement["kind"] for movement in purchase_item_movements] == ["opening_balance"]
    deleted_purchase = backdated_purchase.json()
    assert client.delete(
        f"/inventory-stock-purchases/{deleted_purchase['id']}", headers=headers
    ).status_code == 204
    after_purchase_delete = client.get(
        f"/inventory-items/{purchase_item['id']}", headers=headers
    ).json()
    assert after_purchase_delete["quantityOnHand"] == 10
    assert after_purchase_delete["stockPurchaseCount"] == 1
    assert client.delete(
        f"/inventory-stock-purchases/{deleted_purchase['id']}", headers=headers
    ).status_code == 404
    assert client.delete(f"/inventory-items/{purchase_item['id']}", headers=headers).status_code == 204
    preserved_purchase = client.get("/inventory-stock-purchases", headers=headers).json()[0]
    assert preserved_purchase["id"] == purchase["id"]
    assert preserved_purchase["inventoryItemId"] is None
    assert preserved_purchase["materialName"] == "Bulk black ink"

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
    assert adjustment_response.json()["balanceAfter"] == 675

    movements = client.get(
        "/inventory-movements",
        headers=headers,
        params={"inventory_item_id": inventory_item["id"]},
    ).json()
    assert [movement["kind"] for movement in movements] == ["stock_out", "stock_in", "opening_balance"]

    negative_balance = client.post(
        f"/inventory-items/{inventory_item['id']}/adjustments",
        headers=headers,
        json={"quantityDelta": -700, "kind": "stock_out"},
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

    assert client.delete(f"/products/{product['id']}", headers=headers).status_code == 200

    # The assignment remains restorable with the product for five days. Once
    # that window expires, lazy cleanup removes the unused product and links.
    with test_session() as db:
        db.get(Product, product["id"]).purge_after = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/products/deleted", headers=headers).json() == []

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
    category = next(
        item for item in client.get(
            "/document-analyzer/pricing-categories", headers=headers
        ).json() if item["key"] == "printing"
    )
    assert client.put(
        "/document-analyzer/pricing-categories/printing",
        headers=headers,
        json={
            "name": category["name"],
            "description": category["description"],
            "operationKind": category["operationKind"],
            "materialIds": [paper_item["id"]],
            "isActive": True,
        },
    ).status_code == 200
    assert client.get("/document-analyzer/pricing-rules", headers=headers).status_code == 200
    blocked_by_pricing_rule = client.delete(f"/inventory-items/{paper_item['id']}", headers=headers)
    assert blocked_by_pricing_rule.status_code == 409

    missing_response = client.delete("/inventory-items/missing", headers=headers)
    assert missing_response.status_code == 404
