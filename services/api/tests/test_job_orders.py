import json
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import JobOrderNumberSequence, ObservedPrintJob, Printer
from app.db.session import get_db
from app.modules.document_analyzer.api import router as document_analyzer_router
from app.routers import customers, inventory, job_orders, products, services, variants
from app.services.printing.adapter import PrintSubmission, PrintSubmissionError


def _assign_pricing_materials(client: TestClient, headers: dict[str, str], category_key: str, material_ids: list[str]) -> None:
    category = next(item for item in client.get("/document-analyzer/pricing-categories", headers=headers).json() if item["key"] == category_key)
    response = client.put(
        f"/document-analyzer/pricing-categories/{category_key}",
        headers=headers,
        json={
            "name": category["name"],
            "description": category["description"],
            "operationKind": category["operationKind"],
            "materialIds": material_ids,
            "isActive": category["isActive"],
        },
    )
    assert response.status_code == 200


def test_job_order_number_sequence_handles_million_scale(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'numbers.db'}")
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine)
    with test_session() as db:
        db.add(JobOrderNumberSequence(id=1, next_value=1_000_000))
        db.commit()
        assert job_orders._next_job_order_number(db) == "JOB-0001000000"
        db.commit()
        assert job_orders._next_job_order_number(db) == "JOB-0001000001"


def test_automatic_print_color_follows_analyzed_content_not_product_type() -> None:
    paper_size = SimpleNamespace(value="A4")
    material_plan = SimpleNamespace(inventory_item=SimpleNamespace(paper_size=paper_size))
    order = SimpleNamespace(items=[SimpleNamespace(copies=2, material_plans=[material_plan])])

    monochrome_file = SimpleNamespace(
        detected_color_pages=0,
        detected_bw_pages=3,
        detected_paper_size="A4",
    )
    color_file = SimpleNamespace(
        detected_color_pages=1,
        detected_bw_pages=2,
        detected_paper_size="A4",
    )
    legacy_file = SimpleNamespace(
        detected_color_pages=None,
        detected_bw_pages=None,
        detected_paper_size="A4",
    )

    assert job_orders._automatic_print_settings(order, monochrome_file) == (2, "grayscale", "A4")
    assert job_orders._automatic_print_settings(order, color_file) == (2, "color", "A4")
    assert job_orders._automatic_print_settings(order, legacy_file) == (2, "color", "A4")


def test_job_order_creation_and_material_usage(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'job-orders.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "data_dir", tmp_path / "app-data")

    def override_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(customers.router)
    app.include_router(services.router)
    app.include_router(products.router)
    app.include_router(inventory.router)
    app.include_router(job_orders.router)
    app.include_router(variants.router)
    app.include_router(document_analyzer_router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    customer = client.post(
        "/customers",
        headers=headers,
        json={"displayName": "Juan Dela Cruz", "sourceChannel": "walk_in"},
    ).json()
    paper = _create_material(client, headers, "A4 paper", "sheet", 100, paper_size="A4")
    alternative_paper = _create_material(client, headers, "Short paper", "sheet", 100, paper_size="Letter")
    ink = _create_material(client, headers, "Black ink", "bottle", 50)
    unassigned = _create_material(client, headers, "Long paper", "sheet", 100)
    _assign_pricing_materials(client, headers, "printing", [paper["id"], alternative_paper["id"]])
    _assign_pricing_materials(client, headers, "photocopy", [paper["id"]])

    # A catalog reference uses the lowest assigned paper-material rate, while
    # a job line must use the exact paper material selected for that line.
    rules = client.get("/document-analyzer/pricing-rules", headers=headers).json()
    bw_a4_rule = next(rule for rule in rules if rule["paperSize"] == "A4" and rule["printType"] == "black_and_white" and rule["pricingScope"] == "printing")
    bw_letter_rule = next(rule for rule in rules if rule["paperSize"] == "Letter" and rule["printType"] == "black_and_white" and rule["pricingScope"] == "printing")
    photocopy_bw_a4_rule = next(rule for rule in rules if rule["paperSize"] == "A4" and rule["printType"] == "black_and_white" and rule["pricingScope"] == "photocopy")
    rate_response = client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={
            "rules": [
                {"id": bw_a4_rule["id"], "pricePerPage": 5, "isActive": True},
                {"id": bw_letter_rule["id"], "pricePerPage": 2, "isActive": True},
                {"id": photocopy_bw_a4_rule["id"], "pricePerPage": 3, "isActive": True},
            ]
        },
    )
    assert rate_response.status_code == 200

    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Printing", "category": "printing", "description": None, "isActive": True},
    ).json()
    back_to_back = client.post(
        "/variants",
        headers=headers,
        json={"label": "Back-to-back", "requiresManualDuplex": True, "isActive": True},
    ).json()
    product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Black and white photocopy",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [{"variantId": back_to_back["id"], "priceAdjustment": 1}],
            "materialAssignments": [
                {"inventoryItemId": paper["id"]},
                {"inventoryItemId": alternative_paper["id"]},
                {"inventoryItemId": ink["id"]},
            ],
        },
    ).json()
    assert product["pricePerPage"] == 2

    invalid_response = client.post(
        "/job-orders",
        headers=headers,
        json=_order_payload(customer["id"], product["id"], unassigned["id"]),
    )
    assert invalid_response.status_code == 400

    missing_paper_response = client.post(
        "/job-orders",
        headers=headers,
        json=_order_payload(customer["id"], product["id"], ink["id"]),
    )
    assert missing_paper_response.status_code == 422
    assert missing_paper_response.json()["detail"] == (
        "Select one configured paper size for Black and white photocopy."
    )

    multiple_paper_response = client.post(
        "/job-orders",
        headers=headers,
        json={
            "name": "Multiple paper test",
            "customerId": customer["id"],
            "items": [
                {
                    "productId": product["id"],
                    "pagesPerCopy": 1,
                    "copies": 1,
                    "printSides": "single_sided",
                    "materials": [
                        {"inventoryItemId": paper["id"], "plannedQuantity": 1},
                        {"inventoryItemId": alternative_paper["id"], "plannedQuantity": 1},
                    ],
                }
            ],
        },
    )
    assert multiple_paper_response.status_code == 422

    create_response = client.post(
        "/job-orders",
        headers=headers,
        json={
            "name": "Thesis back-to-back",
            "dueDate": "2026-08-30T17:00:00",
            "notes": "Print after payment confirmation",
            "items": [
                {
                    "productId": product["id"],
                    "variantLabel": "Back-to-back",
                    "pagesPerCopy": 10,
                    "copies": 5,
                    "printSides": "double_sided",
                    "materials": [
                        {"inventoryItemId": paper["id"], "plannedQuantity": 25},
                        {"inventoryItemId": ink["id"], "plannedQuantity": 2},
                    ],
                }
            ],
        },
    )
    assert create_response.status_code == 201
    order = create_response.json()
    assert order["number"] == "JOB-0000000001"
    assert order["name"] == "Thesis back-to-back"
    assert order["customerId"] is None
    assert order["customerName"] is None
    assert order["items"][0]["pagesPerCopy"] == 10
    assert order["items"][0]["unitPrice"] == 6
    assert order["items"][0]["lineTotal"] == 300
    assert order["total"] == 300
    assert order["items"][0]["materials"][0]["consumedQuantity"] == 0
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 100

    # Neither a later global-rate change nor a product edit should alter an
    # already-created order's snapshot.
    rate_change_response = client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={"rules": [{"id": bw_letter_rule["id"], "pricePerPage": 4, "isActive": True}]},
    )
    assert rate_change_response.status_code == 200

    price_update_response = client.put(
        f"/products/{product['id']}",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": product["name"],
            "printType": "black_and_white",
            "isActive": True,
            "variants": [{"variantId": back_to_back["id"], "priceAdjustment": 2}],
            "materialAssignments": [
                {"inventoryItemId": paper["id"]},
                {"inventoryItemId": alternative_paper["id"]},
                {"inventoryItemId": ink["id"]},
            ],
        },
    )
    assert price_update_response.status_code == 200
    assert price_update_response.json()["pricePerPage"] == 4
    priced_order = client.get(f"/job-orders/{order['id']}", headers=headers).json()
    assert priced_order["items"][0]["unitPrice"] == 6
    assert priced_order["items"][0]["lineTotal"] == 300
    assert priced_order["total"] == 300

    paper_plan = next(
        plan for plan in order["items"][0]["materials"] if plan["inventoryItemId"] == paper["id"]
    )
    usage_response = client.post(
        f"/job-orders/{order['id']}/material-usage",
        headers=headers,
        json={"entries": [{"materialPlanId": paper_plan["id"], "quantityUsed": 25}]},
    )
    assert usage_response.status_code == 201
    assert usage_response.json()[0]["kind"] == "job_usage"
    assert usage_response.json()[0]["balanceAfter"] == 75
    refreshed_order = client.get(f"/job-orders/{order['id']}", headers=headers).json()
    refreshed_plan = next(
        plan for plan in refreshed_order["items"][0]["materials"] if plan["inventoryItemId"] == paper["id"]
    )
    assert refreshed_plan["consumedQuantity"] == 25

    insufficient_response = client.post(
        f"/job-orders/{order['id']}/material-usage",
        headers=headers,
        json={"entries": [{"materialPlanId": paper_plan["id"], "quantityUsed": 80}]},
    )
    assert insufficient_response.status_code == 422
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 75

    photocopy_service = client.post(
        "/services",
        headers=headers,
        json={"name": "Xerox", "category": "photocopy", "isActive": True},
    ).json()
    wrong_scope_rate = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": photocopy_service["id"],
            "name": "Wrong global table",
            "operationKind": "photocopy",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
            "documentRates": [{"pricingRuleId": bw_a4_rule["id"], "pricePerPage": 3}],
        },
    )
    assert wrong_scope_rate.status_code == 422
    assert "global table for photocopy" in wrong_scope_rate.json()["detail"]

    global_photocopy_rate = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": photocopy_service["id"],
            "name": "B&W photocopy without a rate",
            "operationKind": "photocopy",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
        },
    )
    assert global_photocopy_rate.status_code == 201
    assert global_photocopy_rate.json()["pricePerPage"] == 3
    assert global_photocopy_rate.json()["documentRates"] == []

    photocopy_product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": photocopy_service["id"],
            "name": "A4 black and white photocopy",
            "operationKind": "photocopy",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [{"variantId": back_to_back["id"], "priceAdjustment": 1}],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
            "documentRates": [{"pricingRuleId": photocopy_bw_a4_rule["id"], "pricePerPage": 3}],
        },
    ).json()
    photocopy_response = client.post(
        "/job-orders/from-photocopy",
        headers=headers,
        json={
            "name": "Reyes ID copies",
            "serviceId": photocopy_service["id"],
            "productId": photocopy_product["id"],
            "paperInventoryItemId": paper["id"],
            "pagesPerCopy": 5,
            "copies": 2,
            "backToBack": True,
        },
    )
    assert photocopy_response.status_code == 201
    photocopy_order = photocopy_response.json()
    assert photocopy_order["workflowCategory"] == "photocopy"
    assert photocopy_order["status"] == "ready"
    assert photocopy_order["files"] == []
    assert photocopy_order["total"] == 40
    assert photocopy_order["items"][0]["printSides"] == "double_sided"
    assert photocopy_order["items"][0]["materials"][0]["plannedQuantity"] == 6
    assert photocopy_order["items"][0]["materials"][0]["consumedQuantity"] == 6
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 69
    # Photocopy is produced entirely on the device: it has no queue to return
    # to, unlike scan (which still has to acquire its pages inside the job).
    photocopy_requeue = client.post(
        f"/job-orders/{photocopy_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "queued"},
    )
    assert photocopy_requeue.status_code == 409

    # Scan products take a print type just like Printing and Photocopy
    # products do — it does not drive pricing (still the flat per-page rate
    # below), but it stays a real, owner-set classification rather than a
    # forced default.
    scan_product_response = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": photocopy_service["id"],
            "name": "Document scan to PDF",
            "operationKind": "scan",
            "standalonePricePerPage": 4,
            "printType": "colored",
            "isActive": True,
            "variants": [],
            "materialAssignments": [],
            "documentRates": [],
        },
    )
    assert scan_product_response.status_code == 201
    scan_product = scan_product_response.json()
    assert scan_product["operationKind"] == "scan"
    assert scan_product["pricePerPage"] == 4
    assert scan_product["materialAssignments"] == []
    assert scan_product["printType"] == "colored"
    assert scan_product["printTypeLabel"] == "Colored"

    scan_buffer = BytesIO()
    Image.new("RGB", (794, 1123), "white").save(scan_buffer, format="PNG")
    scan_output = scan_buffer.getvalue()

    append_response = client.post(
        f"/job-orders/{photocopy_order['id']}/items",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": photocopy_order["name"],
                "initialServiceId": photocopy_service["id"],
                "items": [{"clientKey": "added-scan", "productId": scan_product["id"]}],
            }),
        },
    )
    assert append_response.status_code == 201, append_response.text
    appended_order = append_response.json()
    assert appended_order["status"] == "queued"
    assert appended_order["total"] == 44
    assert [item["status"] for item in appended_order["items"]] == ["ready", "queued"]
    assert appended_order["statusEvents"][0]["note"] == "1 product line(s) added; transaction returned to production."

    appended_scan = appended_order["items"][1]
    append_scan_response = client.post(
        f"/job-orders/{appended_order['id']}/items/{appended_scan['id']}/scan-output",
        headers=headers,
        files=[("files", ("added-scan.png", scan_output, "image/png"))],
    )
    assert append_scan_response.status_code == 201
    assert append_scan_response.json()["status"] == "ready"

    photocopy_item = appended_order["items"][0]
    failed_photocopy = client.post(
        f"/job-orders/{appended_order['id']}/items/{photocopy_item['id']}/transitions",
        headers=headers,
        json={"toStatus": "queued", "note": "Toner streak on the reverse side."},
    )
    assert failed_photocopy.status_code == 200
    assert failed_photocopy.json()["status"] == "queued"
    failed_line = next(item for item in failed_photocopy.json()["items"] if item["id"] == photocopy_item["id"])
    assert failed_line["reprocessCount"] == 1
    assert failed_line["materials"][0]["plannedQuantity"] == 12
    assert failed_line["materials"][0]["consumedQuantity"] == 6
    assert "Toner streak" in failed_line["statusEvents"][0]["note"]

    completed_reprocess = client.post(
        f"/job-orders/{appended_order['id']}/items/{photocopy_item['id']}/transitions",
        headers=headers,
        json={"toStatus": "ready"},
    )
    assert completed_reprocess.status_code == 200
    assert completed_reprocess.json()["status"] == "ready"
    completed_line = next(item for item in completed_reprocess.json()["items"] if item["id"] == photocopy_item["id"])
    assert completed_line["materials"][0]["consumedQuantity"] == 12
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 63

    mixed_response = client.post(
        "/job-orders/transactions",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": "Reyes mixed counter order",
                "initialServiceId": service["id"],
                "items": [
                    {
                        "clientKey": "print-line",
                        "productId": product["id"],
                        "paperInventoryItemId": paper["id"],
                        "pagesPerCopy": 1,
                        "copies": 1,
                    },
                    {
                        "clientKey": "scan-line",
                        "productId": scan_product["id"],
                    },
                    {
                        "clientKey": "copy-line",
                        "productId": photocopy_product["id"],
                        "paperInventoryItemId": paper["id"],
                        "pagesPerCopy": 2,
                        "copies": 1,
                    },
                ],
            }),
            "file_keys": "print-line",
        },
        files=[("files", ("mixed-source.png", scan_output, "image/png"))],
    )
    assert mixed_response.status_code == 201, mixed_response.text
    mixed_order = mixed_response.json()
    assert mixed_order["workflowCategory"] == "custom"
    assert [item["operationKind"] for item in mixed_order["items"]] == ["printing", "scan", "photocopy"]
    assert all(item["status"] == "queued" for item in mixed_order["items"])
    assert mixed_order["files"][0]["jobOrderItemId"] == mixed_order["items"][0]["id"]
    assert mixed_order["total"] == sum(item["lineTotal"] for item in mixed_order["items"])
    mixed_scan_item = next(item for item in mixed_order["items"] if item["operationKind"] == "scan")
    mixed_scan_response = client.post(
        f"/job-orders/{mixed_order['id']}/items/{mixed_scan_item['id']}/scan-output",
        headers=headers,
        files=[("files", ("mixed-scan.png", scan_output, "image/png"))],
    )
    assert mixed_scan_response.status_code == 201, mixed_scan_response.text
    mixed_after_scan = mixed_scan_response.json()
    assert mixed_after_scan["status"] == "queued"
    assert next(item for item in mixed_after_scan["items"] if item["id"] == mixed_scan_item["id"])["status"] == "ready"
    assert next(file for file in mixed_after_scan["files"] if file["kind"] == "scan_output")["jobOrderItemId"] == mixed_scan_item["id"]
    assert client.post(
        f"/job-orders/{mixed_order['id']}/payments",
        headers=headers,
        json={"amount": mixed_order["total"], "method": "cash"},
    ).status_code == 409

    bypass_scan = client.post(
        "/job-orders",
        headers=headers,
        json={"name": "Incomplete scan", "items": [{
            "productId": scan_product["id"], "pagesPerCopy": 1, "copies": 1, "materials": [],
        }]},
    )
    assert bypass_scan.status_code == 422
    assert bypass_scan.json()["detail"] == "Create Scan or Photocopy jobs through their operation-specific workflow."

    # The scan job is created immediately, before any page is acquired: it
    # waits in the queue, just like a print job, until the scan is submitted.
    scan_create_response = client.post(
        "/job-orders/from-scan",
        headers=headers,
        json={
            "name": "Reyes contract scan",
            "serviceId": photocopy_service["id"],
            "productId": scan_product["id"],
        },
    )
    assert scan_create_response.status_code == 201
    scan_order = scan_create_response.json()
    assert scan_order["workflowCategory"] == "photocopy"
    assert scan_order["status"] == "queued"
    assert scan_order["files"] == []
    assert scan_order["items"][0]["operationKind"] == "scan"
    # The job line snapshots the product's real print type, not a forced default.
    assert scan_order["items"][0]["printType"] == "colored"
    assert scan_order["items"][0]["printTypeLabel"] == "Colored"

    empty_scan_output = client.post(f"/job-orders/{scan_order['id']}/scan-output", headers=headers)
    assert empty_scan_output.status_code == 422
    assert empty_scan_output.json()["detail"] == "Acquire at least one page from the scanner."

    scan_output_response = client.post(
        f"/job-orders/{scan_order['id']}/scan-output",
        headers=headers,
        files=[
            ("files", ("reyes-contract-front.png", scan_output, "image/png")),
            ("files", ("reyes-contract-back.png", scan_output, "image/png")),
        ],
    )
    assert scan_output_response.status_code == 201
    scanned_order = scan_output_response.json()
    assert scanned_order["status"] == "ready"
    assert scanned_order["total"] == 8
    assert scanned_order["items"][0]["materials"] == []
    assert scanned_order["files"][0]["kind"] == "scan_output"
    assert scanned_order["items"][0]["pagesPerCopy"] == 2
    assert scanned_order["files"][0]["originalFilename"] == "scanner-output.pdf"
    assert scanned_order["files"][0]["detectedPageCount"] == 2
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 63
    download = client.get(
        f"/job-orders/{scanned_order['id']}/files/{scanned_order['files'][0]['id']}",
        headers=headers,
    )
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF-")
    # Scanned softcopies share the active stage's managed-file boundary so a
    # backup contains both uploaded print files and scanner output.
    scan_job_directory = settings.resolved_scan_output_dir / scanned_order["id"]
    assert scan_job_directory.is_dir()
    assert any(scan_job_directory.iterdir())
    assert settings.resolved_scan_output_dir == settings.resolved_data_dir / "files" / "scans"

    # A failed quality check sends the scan back to the queue for a re-scan;
    # resubmitting replaces the prior softcopy rather than keeping both.
    requeued = client.post(
        f"/job-orders/{scanned_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "queued"},
    )
    assert requeued.status_code == 200
    assert requeued.json()["status"] == "queued"
    rescan_output_response = client.post(
        f"/job-orders/{scanned_order['id']}/scan-output",
        headers=headers,
        files=[("files", ("reyes-contract-final.png", scan_output, "image/png"))],
    )
    assert rescan_output_response.status_code == 201
    rescanned_order = rescan_output_response.json()
    assert rescanned_order["status"] == "ready"
    assert len(rescanned_order["files"]) == 1
    assert rescanned_order["files"][0]["originalFilename"] == "reyes-contract-final.png"
    assert rescanned_order["items"][0]["pagesPerCopy"] == 1
    assert rescanned_order["total"] == 4


def test_analyzed_transaction_saves_owner_price_and_file_only_on_confirmation(tmp_path, monkeypatch) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'analyzed-job.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "data_dir", tmp_path / "app-data")
    monkeypatch.setattr(settings, "printer_platform", "windows")

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
    app.include_router(document_analyzer_router)
    app.include_router(job_orders.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    # The uploaded image is A4, while the owner deliberately chooses Letter.
    # Detection must remain advisory throughout pricing, inventory, and printing.
    paper = _create_material(client, headers, "Letter transaction paper", "sheet", 100, paper_size="Letter")
    _assign_pricing_materials(client, headers, "printing", [paper["id"]])
    rules = client.get("/document-analyzer/pricing-rules", headers=headers).json()
    bw_rule = next(rule for rule in rules if rule["paperSize"] == "Letter" and rule["printType"] == "black_and_white" and rule["pricingScope"] == "printing")
    assert client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={"rules": [{"id": bw_rule["id"], "pricePerPage": 5, "isActive": True}]},
    ).status_code == 200
    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Transaction printing", "category": "printing", "isActive": True},
    ).json()
    product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Letter B&W-priced document",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
        },
    ).json()
    image_buffer = BytesIO()
    Image.new("RGB", (794, 1123), (190, 30, 30)).save(image_buffer, format="PNG", dpi=(96, 96))
    document = image_buffer.getvalue()

    analysis_response = client.post(
        "/document-analyzer/analyze",
        headers=headers,
        data={"product_id": product["id"], "paper_inventory_item_id": paper["id"]},
        files={"file": ("customer-a4.png", document, "image/png")},
    )
    assert analysis_response.status_code == 200
    assert analysis_response.json()["analysis"]["paperSize"] == "A4"
    assert analysis_response.json()["pricing"]["baseSubtotal"] == 5
    assert analysis_response.json()["pricing"]["breakdown"][0]["paperSize"] == "Letter"
    assert client.get("/job-orders", headers=headers).json() == []
    assert not (tmp_path / "app-data" / "files").exists()

    with test_session() as db:
        observed = ObservedPrintJob(
            spooler_key="Canon G4770 series, 73|submitted",
            os_job_id="73",
            printer_name="Canon G4770 series",
            document_name="customer-a4.png",
            status="released",
        )
        db.add(observed)
        db.commit()
        observed_id = observed.id

    transaction = {
        "name": "Customer A4 poster",
        "productId": product["id"],
        "paperInventoryItemId": paper["id"],
        "copies": 2,
        "priceMode": "custom",
        "customPrice": 25,
        "observedPrintJobId": observed_id,
        "otherMaterials": [],
    }
    response = client.post(
        "/job-orders/from-analysis",
        headers=headers,
        data={"transaction": json.dumps(transaction)},
        files={"file": ("customer-a4.png", document, "image/png")},
    )

    assert response.status_code == 201
    order = response.json()
    assert order["total"] == 25
    assert order["suggestedTotal"] > 0
    assert order["priceOverridden"] is True
    assert order["items"][0]["pagesPerCopy"] == 1
    assert order["items"][0]["copies"] == 2
    assert order["items"][0]["materials"][0]["plannedQuantity"] == 2
    assert order["items"][0]["materials"][0]["paperSize"] == "Letter"
    assert order["files"][0]["originalFilename"] == "customer-a4.png"
    assert order["files"][0]["kind"] == "print_ready"
    assert order["files"][0]["detectedPageCount"] == 1
    assert order["files"][0]["detectedPaperSize"] == "A4"
    assert order["files"][0]["detectedOrientation"] == "portrait"
    assert order["files"][0]["detectedColorPages"] == 1
    assert order["files"][0]["detectedBwPages"] == 0
    assert order["files"][0]["estimatedInkCoveragePercent"] is not None
    with test_session() as db:
        linked_observed = db.get(ObservedPrintJob, observed_id)
        assert linked_observed is not None
        assert linked_observed.review_status == "linked"
        assert linked_observed.linked_job_order_id == order["id"]

    download = client.get(
        f"/job-orders/{order['id']}/files/{order['files'][0]['id']}",
        headers=headers,
    )
    assert download.status_code == 200
    assert download.content == document

    # A job order is placed directly into the print queue on creation; there
    # is no pre-print payment gate. Payment is only accepted once the job
    # reaches the Ready step, after printing.
    assert order["status"] == "queued"
    premature_payment = client.post(
        f"/job-orders/{order['id']}/payments",
        headers=headers,
        json={"amount": 10, "method": "cash"},
    )
    assert premature_payment.status_code == 409

    with test_session() as db:
        printer = Printer(
            system_name="Canon G4770 series",
            display_name="Canon G4770 series",
            is_default=True,
            last_seen_state="idle",
        )
        db.add(printer)
        db.commit()
        db.refresh(printer)
        printer_id = printer.id

    class StubPrintAdapter:
        fail = True
        calls = []

        def submit_file(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            if self.fail:
                raise PrintSubmissionError("Test queue rejected the first attempt.")
            return PrintSubmission(external_job_id="Canon-42")

    stub_adapter = StubPrintAdapter()
    monkeypatch.setattr(job_orders, "get_printer_adapter", lambda _platform: stub_adapter)
    print_payload = {
        "printerId": printer_id,
        "jobFileId": order["files"][0]["id"],
        # Legacy copies, paper, and output hints are non-authoritative.
        "copies": 99,
        "colorMode": "grayscale",
        "mediaSize": "Legal",
    }
    assert client.post(
        f"/inventory-items/{paper['id']}/adjustments",
        headers=headers,
        json={"kind": "stock_out", "quantityDelta": -99, "note": "Simulate low stock"},
    ).status_code == 201
    low_stock_print = client.post(
        f"/job-orders/{order['id']}/print-attempts",
        headers=headers,
        json=print_payload,
    )
    assert low_stock_print.status_code == 409
    assert "Required 2 sheet; available 1" in low_stock_print.json()["detail"]
    assert client.get(f"/job-orders/{order['id']}", headers=headers).json()["printAttempts"] == []
    assert client.post(
        f"/inventory-items/{paper['id']}/adjustments",
        headers=headers,
        json={"kind": "stock_in", "quantityDelta": 99, "note": "Restore stock"},
    ).status_code == 201
    failed_print = client.post(
        f"/job-orders/{order['id']}/print-attempts",
        headers=headers,
        json=print_payload,
    )
    assert failed_print.status_code == 502
    after_failure = client.get(f"/job-orders/{order['id']}", headers=headers).json()
    assert after_failure["status"] == "queued"
    assert after_failure["printAttempts"][0]["result"] == "failed"
    assert after_failure["printAttempts"][0]["colorMode"] == "color"
    assert after_failure["printAttempts"][0]["scaling"] == "auto"
    assert after_failure["printAttempts"][0]["quality"] == "auto"
    assert after_failure["items"][0]["materials"][0]["consumedQuantity"] == 0
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 100

    incomplete_custom_size = client.post(
        f"/job-orders/{order['id']}/print-attempts",
        headers=headers,
        json={
            "printerId": printer_id,
            "jobFileId": order["files"][0]["id"],
            "mediaSize": "Custom",
            "mediaWidthMm": 102,
        },
    )
    assert incomplete_custom_size.status_code == 422
    assert "both width and height" in incomplete_custom_size.json()["detail"]

    stub_adapter.fail = False
    printed = client.post(
        f"/job-orders/{order['id']}/print-attempts",
        headers=headers,
        json={
            "printerId": printer_id,
            "jobFileId": order["files"][0]["id"],
            "orientation": "landscape",
            "scaling": "fill",
            "quality": "high",
            "mediaType": "photo_plus_glossy_ii",
            "mediaSize": "Custom",
            "mediaWidthMm": 102,
            "mediaHeightMm": 152,
            "borderless": False,
            "collate": False,
        },
    )
    assert printed.status_code == 201
    assert printed.json()["status"] == "printing"
    assert printed.json()["assignedPrinterId"] == printer_id
    assert printed.json()["printAttempts"][0]["result"] == "succeeded"
    assert printed.json()["printAttempts"][0]["externalJobId"] == "Canon-42"
    assert printed.json()["printAttempts"][0]["copies"] == 2
    assert printed.json()["printAttempts"][0]["colorMode"] == "color"
    assert printed.json()["printAttempts"][0]["mediaSize"] == "Custom"
    assert printed.json()["printAttempts"][0]["mediaWidthMm"] == 102
    assert printed.json()["printAttempts"][0]["mediaHeightMm"] == 152
    assert printed.json()["printAttempts"][0]["mediaType"] == "photo_plus_glossy_ii"
    assert printed.json()["printAttempts"][0]["orientation"] == "landscape"
    assert printed.json()["printAttempts"][0]["scaling"] == "fill"
    assert printed.json()["printAttempts"][0]["quality"] == "high"
    assert printed.json()["printAttempts"][0]["borderless"] is False
    assert printed.json()["printAttempts"][0]["collate"] is False
    assert stub_adapter.calls[-1][1]["media_type"] == "photo_plus_glossy_ii"
    assert stub_adapter.calls[-1][1]["orientation"] == "landscape"
    assert stub_adapter.calls[-1][1]["scaling"] == "fill"
    assert stub_adapter.calls[-1][1]["quality"] == "high"
    assert stub_adapter.calls[-1][1]["borderless"] is False
    assert stub_adapter.calls[-1][1]["collate"] is False
    assert stub_adapter.calls[-1][1]["media_width_mm"] == 102
    assert stub_adapter.calls[-1][1]["media_height_mm"] == 152
    assert stub_adapter.calls[-1][1]["tracking_id"] == printed.json()["printAttempts"][0]["id"]
    assert printed.json()["items"][0]["materials"][0]["consumedQuantity"] == 2
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 98
    auto_movements = client.get(
        f"/inventory-movements?job_order_id={order['id']}",
        headers=headers,
    ).json()
    assert len(auto_movements) == 1
    assert auto_movements[0]["kind"] == "job_usage"
    assert auto_movements[0]["quantityDelta"] == -2
    assert "Automatically deducted" in auto_movements[0]["note"]

    manual_variant = client.post(
        "/variants",
        headers=headers,
        json={
            "label": "Supervised back-to-back",
            "requiresManualDuplex": True,
            "isActive": True,
        },
    ).json()
    manual_product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Manual duplex document",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [{"variantId": manual_variant["id"], "priceAdjustment": 0}],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
        },
    ).json()
    manual_pdf = pymupdf.open()
    for page_number in range(1, 5):
        page = manual_pdf.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Manual duplex page {page_number}")
    manual_document = manual_pdf.tobytes()
    manual_pdf.close()
    manual_order_response = client.post(
        "/job-orders/from-analysis",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": "Manual duplex booklet",
                "productId": manual_product["id"],
                "paperInventoryItemId": paper["id"],
                "variantId": manual_variant["id"],
                "copies": 1,
                "priceMode": "suggested",
                "otherMaterials": [],
            })
        },
        files={"file": ("manual-duplex.pdf", manual_document, "application/pdf")},
    )
    assert manual_order_response.status_code == 201
    manual_order = manual_order_response.json()
    assert manual_order["items"][0]["requiresManualDuplex"] is True
    assert manual_order["items"][0]["materials"][0]["plannedQuantity"] == 2
    assert manual_order["status"] == "queued"
    stock_before_front = client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"]
    front_pass = client.post(
        f"/job-orders/{manual_order['id']}/print-attempts",
        headers=headers,
        json={
            "printerId": printer_id,
            "jobFileId": manual_order["files"][0]["id"],
            "duplexPass": "front",
        },
    )
    assert front_pass.status_code == 201
    assert front_pass.json()["status"] == "queued"
    assert front_pass.json()["printAttempts"][0]["duplexPass"] == "front"
    assert stub_adapter.calls[-1][1]["duplex_pass"] == "front"
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == stock_before_front
    wrong_printer_pass = client.post(
        f"/job-orders/{manual_order['id']}/print-attempts",
        headers=headers,
        json={
            "printerId": printer_id,
            "jobFileId": manual_order["files"][0]["id"],
            "duplexPass": "front",
        },
    )
    assert wrong_printer_pass.status_code == 409
    back_pass = client.post(
        f"/job-orders/{manual_order['id']}/print-attempts",
        headers=headers,
        json={
            "printerId": printer_id,
            "jobFileId": manual_order["files"][0]["id"],
            "duplexPass": "back",
        },
    )
    assert back_pass.status_code == 201
    assert back_pass.json()["status"] == "printing"
    assert back_pass.json()["printAttempts"][0]["duplexPass"] == "back"
    assert stub_adapter.calls[-1][1]["duplex_pass"] == "back"
    assert back_pass.json()["items"][0]["materials"][0]["consumedQuantity"] == 2
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == stock_before_front - 2

    # Quality inspection is not its own status: printing lands directly in
    # Ready, which hosts the quality check. A bad check re-queues the job for
    # a re-print; a good check collects payment before the job is paid.
    ready_transition = client.post(
        f"/job-orders/{order['id']}/transitions",
        headers=headers,
        json={"toStatus": "ready"},
    )
    assert ready_transition.status_code == 200
    assert ready_transition.json()["status"] == "ready"
    assert ready_transition.json()["statusEvents"][0]["fromStatus"] == "printing"

    premature_ready_to_paid = client.post(
        f"/job-orders/{order['id']}/transitions",
        headers=headers,
        json={"toStatus": "paid"},
    )
    assert premature_ready_to_paid.status_code == 422

    partial_payment = client.post(
        f"/job-orders/{order['id']}/payments",
        headers=headers,
        json={"amount": 10, "method": "cash"},
    )
    assert partial_payment.status_code == 201
    assert partial_payment.json()["status"] == "ready"
    assert partial_payment.json()["amountPaid"] == 10
    paid_cancel = client.post(
        f"/job-orders/{order['id']}/cancel",
        headers=headers,
        json={"reason": "Customer requested cancellation after a deposit."},
    )
    assert paid_cancel.status_code == 409
    assert "Resolve the refund" in paid_cancel.json()["detail"]
    overpayment = client.post(
        f"/job-orders/{order['id']}/payments",
        headers=headers,
        json={"amount": 16, "method": "cash"},
    )
    assert overpayment.status_code == 422
    paid = client.post(
        f"/job-orders/{order['id']}/payments",
        headers=headers,
        json={"amount": 15, "method": "online"},
    )
    assert paid.status_code == 201
    assert paid.json()["status"] == "paid"
    assert paid.json()["amountPaid"] == 25

    completed_transition = client.post(
        f"/job-orders/{order['id']}/transitions",
        headers=headers,
        json={"toStatus": "completed"},
    )
    assert completed_transition.status_code == 200
    assert completed_transition.json()["status"] == "completed"
    assert completed_transition.json()["statusEvents"][0]["fromStatus"] == "paid"

    completed = client.get(f"/job-orders/{order['id']}", headers=headers).json()
    assert [event["toStatus"] for event in completed["statusEvents"]] == [
        "completed",
        "paid",
        "ready",
        "printing",
        "queued",
    ]

    suggested_response = client.post(
        "/job-orders/from-analysis",
        headers=headers,
        data={
            "transaction": json.dumps(
                {
                    "name": "Second A4 run",
                    "productId": product["id"],
                    "paperInventoryItemId": paper["id"],
                    "copies": 3,
                    "priceMode": "suggested",
                    "otherMaterials": [],
                }
            )
        },
        files={"file": ("second-a4.png", document, "image/png")},
    )
    assert suggested_response.status_code == 201
    suggested_order = suggested_response.json()
    assert suggested_order["total"] == suggested_order["suggestedTotal"]
    assert suggested_order["priceOverridden"] is False
    assert suggested_order["status"] == "queued"

    # A failed quality check in Ready sends the job back to the queue for a
    # re-print rather than moving through a separate quality-check status.
    first_pass = client.post(
        f"/job-orders/{suggested_order['id']}/print-attempts",
        headers=headers,
        json={"printerId": printer_id, "jobFileId": suggested_order["files"][0]["id"]},
    )
    assert first_pass.status_code == 201
    assert first_pass.json()["status"] == "printing"
    assert client.post(
        f"/job-orders/{suggested_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "ready"},
    ).status_code == 200

    reprint = client.post(
        f"/job-orders/{suggested_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "queued"},
    )
    assert reprint.status_code == 200
    assert reprint.json()["status"] == "queued"
    assert reprint.json()["items"][0]["reprocessCount"] == 1
    assert reprint.json()["items"][0]["materials"][0]["plannedQuantity"] == 6
    assert reprint.json()["items"][0]["materials"][0]["consumedQuantity"] == 3
    assert "entered reprocess cycle 1" in reprint.json()["statusEvents"][0]["note"]

    stock_before_reprint = client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"]
    second_pass = client.post(
        f"/job-orders/{suggested_order['id']}/print-attempts",
        headers=headers,
        json={"printerId": printer_id, "jobFileId": suggested_order["files"][0]["id"]},
    )
    assert second_pass.status_code == 201
    assert second_pass.json()["status"] == "printing"
    # A quality-failed output is still consumed work. The re-print receives
    # and deducts a fresh cycle of the same material plan.
    assert second_pass.json()["items"][0]["materials"][0]["consumedQuantity"] == 6
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == stock_before_reprint - 3

    cancelled = client.post(
        f"/job-orders/{suggested_order['id']}/cancel",
        headers=headers,
        json={"reason": "Customer no longer needs the replacement output."},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["items"][0]["reprocessCount"] == 1
    assert "Customer no longer needs" in cancelled.json()["statusEvents"][0]["note"]
    assert client.get(f"/job-orders/{suggested_order['id']}", headers=headers).status_code == 200
    assert client.post(
        f"/job-orders/{suggested_order['id']}/items/{suggested_order['items'][0]['id']}/transitions",
        headers=headers,
        json={"toStatus": "ready"},
    ).status_code == 409
    assert client.post(
        f"/job-orders/{suggested_order['id']}/print-attempts",
        headers=headers,
        json={"printerId": printer_id, "jobFileId": suggested_order["files"][0]["id"]},
    ).status_code == 409
    assert client.post(
        f"/job-orders/{suggested_order['id']}/cancel",
        headers=headers,
        json={"reason": "Duplicate cancellation request."},
    ).status_code == 409

    assert client.post(
        f"/job-orders/{order['id']}/cancel",
        headers=headers,
        json={"reason": "Completed orders stay immutable."},
    ).status_code == 409

    # A job with no outstanding balance can move from Ready straight to Paid
    # without a payment record; one with a balance owed cannot.
    zero_balance_response = client.post(
        "/job-orders/from-analysis",
        headers=headers,
        data={
            "transaction": json.dumps(
                {
                    "name": "Free sample copy",
                    "productId": product["id"],
                    "paperInventoryItemId": paper["id"],
                    "copies": 1,
                    "priceMode": "custom",
                    "customPrice": 0,
                    "otherMaterials": [],
                }
            )
        },
        files={"file": ("free-copy.png", document, "image/png")},
    )
    assert zero_balance_response.status_code == 201
    zero_balance_order = zero_balance_response.json()
    assert zero_balance_order["total"] == 0
    assert zero_balance_order["status"] == "queued"
    assert client.post(
        f"/job-orders/{zero_balance_order['id']}/print-attempts",
        headers=headers,
        json={"printerId": printer_id, "jobFileId": zero_balance_order["files"][0]["id"]},
    ).status_code == 201
    assert client.post(
        f"/job-orders/{zero_balance_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "ready"},
    ).status_code == 200
    no_payment_needed = client.post(
        f"/job-orders/{zero_balance_order['id']}/transitions",
        headers=headers,
        json={"toStatus": "paid"},
    )
    assert no_payment_needed.status_code == 200
    assert no_payment_needed.json()["status"] == "paid"


def test_transaction_lines_from_observed_prints_are_recorded_ready_and_combined(tmp_path, monkeypatch) -> None:
    """Ad-hoc recording of work already printed outside Printing-MS (e.g. Canon
    PRINT): each tagged line starts (and stays) 'ready' instead of 'queued',
    several separately-tracked prints can combine into one transaction, and
    each one's material usage is deducted immediately since there is no live
    submission afterward to trigger the usual post-print deduction."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'observed-transaction.db'}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "data_dir", tmp_path / "app-data")

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
    app.include_router(document_analyzer_router)
    app.include_router(job_orders.router)
    client = TestClient(app)
    headers = {"X-Print-MS-Token": settings.token}

    paper = _create_material(client, headers, "Letter observed paper", "sheet", 100, paper_size="Letter")
    _assign_pricing_materials(client, headers, "printing", [paper["id"]])
    rules = client.get("/document-analyzer/pricing-rules", headers=headers).json()
    bw_rule = next(rule for rule in rules if rule["paperSize"] == "Letter" and rule["printType"] == "black_and_white" and rule["pricingScope"] == "printing")
    assert client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={"rules": [{"id": bw_rule["id"], "pricePerPage": 5, "isActive": True}]},
    ).status_code == 200
    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Ad-hoc printing", "category": "printing", "isActive": True},
    ).json()
    product = client.post(
        "/products",
        headers=headers,
        json={
            "serviceId": service["id"],
            "name": "Letter B&W-priced document",
            "printType": "black_and_white",
            "isActive": True,
            "variants": [],
            "materialAssignments": [{"inventoryItemId": paper["id"]}],
        },
    ).json()

    image_buffer = BytesIO()
    Image.new("RGB", (850, 1100), (10, 10, 10)).save(image_buffer, format="PNG", dpi=(100, 100))
    document = image_buffer.getvalue()

    def make_observed(os_job_id: str, document_name: str) -> str:
        with test_session() as db:
            observed = ObservedPrintJob(
                spooler_key=f"Canon G4770 series, {os_job_id}|submitted",
                os_job_id=os_job_id,
                printer_name="Canon G4770 series",
                document_name=document_name,
                status="released",
            )
            db.add(observed)
            db.commit()
            return observed.id

    first_id = make_observed("101", "first-canon-print.png")
    second_id = make_observed("102", "second-canon-print.png")

    response = client.post(
        "/job-orders/transactions",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": "Combined ad-hoc reconciliation",
                "initialServiceId": service["id"],
                "items": [
                    {
                        "clientKey": "first-line",
                        "productId": product["id"],
                        "paperInventoryItemId": paper["id"],
                        "copies": 1,
                        "observedPrintJobId": first_id,
                    },
                    {
                        "clientKey": "second-line",
                        "productId": product["id"],
                        "paperInventoryItemId": paper["id"],
                        "copies": 1,
                        "observedPrintJobId": second_id,
                    },
                ],
            }),
            "file_keys": ["first-line", "second-line"],
        },
        files=[
            ("files", ("first-canon-print.png", document, "image/png")),
            ("files", ("second-canon-print.png", document, "image/png")),
        ],
    )
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["status"] == "ready"
    assert [item["status"] for item in order["items"]] == ["ready", "ready"]
    assert order["statusEvents"][0]["note"] == "Transaction created from Windows print(s) already completed outside Printing-MS."

    with test_session() as db:
        linked_first = db.get(ObservedPrintJob, first_id)
        linked_second = db.get(ObservedPrintJob, second_id)
        assert linked_first.review_status == "linked"
        assert linked_first.linked_job_order_id == order["id"]
        assert linked_first.linked_job_order_item_id == order["items"][0]["id"]
        assert linked_second.linked_job_order_item_id == order["items"][1]["id"]

    assert order["items"][0]["materials"][0]["plannedQuantity"] == order["items"][0]["materials"][0]["consumedQuantity"]
    assert client.get(f"/inventory-items/{paper['id']}", headers=headers).json()["quantityOnHand"] == 98

    # An observed print already linked to a job order cannot be recorded again.
    reuse_response = client.post(
        "/job-orders/transactions",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": "Duplicate reconciliation attempt",
                "initialServiceId": service["id"],
                "items": [{
                    "clientKey": "reuse-line",
                    "productId": product["id"],
                    "paperInventoryItemId": paper["id"],
                    "copies": 1,
                    "observedPrintJobId": first_id,
                }],
            }),
            "file_keys": "reuse-line",
        },
        files=[("files", ("reuse.png", document, "image/png"))],
    )
    assert reuse_response.status_code == 409

    # The same observed print cannot be recorded twice within one transaction.
    third_id = make_observed("103", "third-canon-print.png")
    duplicate_within_transaction = client.post(
        "/job-orders/transactions",
        headers=headers,
        data={
            "transaction": json.dumps({
                "name": "Duplicate within one transaction",
                "initialServiceId": service["id"],
                "items": [
                    {
                        "clientKey": "dup-line-1",
                        "productId": product["id"],
                        "paperInventoryItemId": paper["id"],
                        "copies": 1,
                        "observedPrintJobId": third_id,
                    },
                    {
                        "clientKey": "dup-line-2",
                        "productId": product["id"],
                        "paperInventoryItemId": paper["id"],
                        "copies": 1,
                        "observedPrintJobId": third_id,
                    },
                ],
            }),
            "file_keys": ["dup-line-1", "dup-line-2"],
        },
        files=[
            ("files", ("dup1.png", document, "image/png")),
            ("files", ("dup2.png", document, "image/png")),
        ],
    )
    assert duplicate_within_transaction.status_code == 422


def _create_material(
    client: TestClient, headers: dict[str, str], name: str, unit: str, quantity: float, *, paper_size: str | None = None
) -> dict:
    return client.post(
        "/inventory-items",
        headers=headers,
        json={
            "name": name,
            "category": "Paper" if unit == "sheet" else "Ink",
            "unit": unit,
            "openingQuantity": quantity,
            "reorderLevel": 0,
            "paperSize": paper_size,
            "isActive": True,
        },
    ).json()


def _order_payload(customer_id: str, product_id: str, inventory_item_id: str) -> dict:
    return {
        "name": "Paper validation job",
        "customerId": customer_id,
        "items": [
            {
                "productId": product_id,
                "pagesPerCopy": 1,
                "copies": 1,
                "printSides": "single_sided",
                "materials": [{"inventoryItemId": inventory_item_id, "plannedQuantity": 1}],
            }
        ],
    }
