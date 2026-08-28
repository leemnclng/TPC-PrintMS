from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.routers import inventory, print_types, products, services, variants


def test_service_owns_products_and_cannot_be_removed_while_in_use(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'catalog.db'}",
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
    app.include_router(variants.router)
    app.include_router(print_types.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    configured_types = client.get("/print-types", headers=headers).json()
    assert [item["key"] for item in configured_types] == [
        "black_and_white",
        "semi_colored",
        "colored",
    ]
    spot_type_response = client.post(
        "/print-types",
        headers=headers,
        json={
            "label": "Spot color",
            "description": "One selected accent color",
            "colorMode": "color",
            "appliesInkCoverage": True,
        },
    )
    assert spot_type_response.status_code == 201
    assert spot_type_response.json()["key"] == "spot_color"

    service_response = client.post(
        "/services",
        headers=headers,
        json={"name": "Printing service", "description": "Printed products", "isActive": True},
    )
    assert service_response.status_code == 201
    service = service_response.json()
    assert service["productCount"] == 0
    matte_response = client.post(
        "/variants",
        headers=headers,
        json={
            "label": "Matte",
            "description": "Matte surface finish",
            "isActive": True,
        },
    )
    assert matte_response.status_code == 201
    matte = matte_response.json()
    assert matte["linkedProductCount"] == 0

    material_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Card stock",
            "category": "Paper",
            "unit": "sheet",
            "openingQuantity": 100,
            "reorderLevel": 20,
            "isActive": True,
        },
    )
    assert material_response.status_code == 201
    material = material_response.json()
    ink_response = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Black ink",
            "category": "Ink",
            "unit": "milliliter",
            "openingQuantity": 500,
            "reorderLevel": 50,
            "isActive": True,
        },
    )
    assert ink_response.status_code == 201
    ink = ink_response.json()

    missing_assignments_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Incomplete product",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [],
        },
    )
    assert missing_assignments_response.status_code == 422

    inactive_material = client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": "Retired stock",
            "category": "Paper",
            "unit": "sheet",
            "isActive": False,
        },
    ).json()
    inactive_assignment_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Inactive material product",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": inactive_material["id"]}],
        },
    )
    assert inactive_assignment_response.status_code == 409

    invalid_type_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Sepia cards",
            "printType": "sepia",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": material["id"]}],
        },
    )
    assert invalid_type_response.status_code == 422

    product_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Business cards",
            "description": "Two-sided cards",
            "printType": "colored",
            "isActive": True,
            "variants": [{"variantId": matte["id"], "priceAdjustment": 25}],
            "materialAssignments": [
                {"inventoryItemId": material["id"]},
                {"inventoryItemId": ink["id"]},
            ],
        },
    )
    assert product_response.status_code == 201
    product = product_response.json()
    assert product["serviceId"] == service["id"]
    assert product["serviceName"] == "Printing service"
    assert product["printType"] == "colored"
    assert product["variants"][0]["variantId"] == matte["id"]
    assert product["variants"][0]["label"] == "Matte"
    assert {
        assignment["inventoryItemName"]
        for assignment in product["materialAssignments"]
    } == {"Card stock", "Black ink"}

    second_service = client.post(
        "/services",
        headers=headers,
        json={"name": "Finishing service", "description": None, "isActive": True},
    ).json()
    second_product_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": second_service["id"],
            "name": "Laminated card",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [{"variantId": matte["id"], "priceAdjustment": 30}],
            "materialAssignments": [{"inventoryItemId": material["id"]}],
        },
    )
    assert second_product_response.status_code == 201
    second_product = second_product_response.json()
    assert second_product["printType"] == "black_and_white"
    assert second_product["variants"][0]["variantId"] == matte["id"]

    services_response = client.get("/services", headers=headers)
    assert services_response.status_code == 200
    assert services_response.json()[0]["productCount"] == 1

    products_response = client.get(
        "/products",
        headers=headers,
        params={"service_id": service["id"]},
    )
    assert products_response.status_code == 200
    assert [item["name"] for item in products_response.json()] == ["Business cards"]

    custom_type_product_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Spot-color card",
            "printType": "spot_color",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": material["id"]}],
        },
    )
    assert custom_type_product_response.status_code == 201
    custom_type_product = custom_type_product_response.json()
    assert custom_type_product["printTypeLabel"] == "Spot color"
    assert custom_type_product["printColorMode"] == "color"

    variants_response = client.get("/variants", headers=headers)
    assert variants_response.status_code == 200
    assert variants_response.json()[0]["linkedProductCount"] == 2

    blocked_variant_delete = client.delete(
        f"/variants/{matte['id']}",
        headers=headers,
    )
    assert blocked_variant_delete.status_code == 409

    blocked_delete = client.delete(f"/services/{service['id']}", headers=headers)
    assert blocked_delete.status_code == 409

    assert client.delete(f"/products/{product['id']}", headers=headers).status_code == 204
    assert client.delete(f"/products/{custom_type_product['id']}", headers=headers).status_code == 204
    assert client.delete(f"/products/{second_product['id']}", headers=headers).status_code == 204
    assert client.delete(
        f"/variants/{matte['id']}",
        headers=headers,
    ).status_code == 204
    assert client.delete(f"/services/{service['id']}", headers=headers).status_code == 204
    assert client.delete(f"/services/{second_service['id']}", headers=headers).status_code == 204
