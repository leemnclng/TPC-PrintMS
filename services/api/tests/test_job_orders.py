import json
from io import BytesIO
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


def test_job_order_creation_and_material_usage(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'job-orders.db'}",
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
    ink = _create_material(client, headers, "Black ink", "ml", 50)
    unassigned = _create_material(client, headers, "Long paper", "sheet", 100)

    # A catalog reference uses the lowest assigned paper-material rate, while
    # a job line must use the exact paper material selected for that line.
    rules = client.get("/document-analyzer/pricing-rules", headers=headers).json()
    bw_a4_rule = next(rule for rule in rules if rule["paperSize"] == "A4" and rule["printType"] == "black_and_white")
    bw_letter_rule = next(rule for rule in rules if rule["paperSize"] == "Letter" and rule["printType"] == "black_and_white")
    rate_response = client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={
            "rules": [
                {"id": bw_a4_rule["id"], "pricePerPage": 5, "isActive": True},
                {"id": bw_letter_rule["id"], "pricePerPage": 2, "isActive": True},
            ]
        },
    )
    assert rate_response.status_code == 200

    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Printing", "description": None, "isActive": True},
    ).json()
    back_to_back = client.post(
        "/variants",
        headers=headers,
        json={"label": "Back-to-back", "isActive": True},
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
    rules = client.get("/document-analyzer/pricing-rules", headers=headers).json()
    bw_rule = next(rule for rule in rules if rule["paperSize"] == "Letter" and rule["printType"] == "black_and_white")
    assert client.put(
        "/document-analyzer/pricing-rules",
        headers=headers,
        json={"rules": [{"id": bw_rule["id"], "pricePerPage": 5, "isActive": True}]},
    ).status_code == 200
    service = client.post(
        "/services",
        headers=headers,
        json={"name": "Transaction printing", "isActive": True},
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

        def submit_file(self, *args):
            self.calls.append(args)
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
    assert printed.json()["printAttempts"][0]["mediaSize"] == "Letter"
    assert printed.json()["printAttempts"][0]["orientation"] == "landscape"
    assert printed.json()["printAttempts"][0]["scaling"] == "fill"
    assert printed.json()["printAttempts"][0]["quality"] == "high"
    assert printed.json()["printAttempts"][0]["borderless"] is False
    assert printed.json()["printAttempts"][0]["collate"] is False
    assert stub_adapter.calls[-1][5:10] == ("landscape", "fill", "high", False, False)
    assert stub_adapter.calls[-1][10] == printed.json()["printAttempts"][0]["id"]
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
    assert stub_adapter.calls[-1][11] == "front"
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
    assert stub_adapter.calls[-1][11] == "back"
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
    assert reprint.json()["statusEvents"][0]["note"] == "Quality check did not pass; job requeued for a re-print."

    second_pass = client.post(
        f"/job-orders/{suggested_order['id']}/print-attempts",
        headers=headers,
        json={"printerId": printer_id, "jobFileId": suggested_order["files"][0]["id"]},
    )
    assert second_pass.status_code == 201
    assert second_pass.json()["status"] == "printing"
    # The planned paper was already fully deducted on the first pass, so the
    # re-print deducts nothing further.
    assert (
        second_pass.json()["items"][0]["materials"][0]["consumedQuantity"]
        == first_pass.json()["items"][0]["materials"][0]["consumedQuantity"]
    )

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
