from datetime import date, timedelta
from io import BytesIO

import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.models import BusinessProfile, Customer, JobOrder, JobOrderItem, Payment, PrintType, Product, Quotation, Service
from app.db.session import get_db
from app.routers import job_orders, quotations


def _setup(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'sales-documents.db'}", connect_args={"check_same_thread": False})
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    with session() as db:
        profile = BusinessProfile(business_name="The Paper Club", owner_name="Owner", quotation_prefix="QUO", job_order_prefix="JOB")
        customer = Customer(display_name="Maria Santos")
        service = Service(name="Document Printing", category="printing")
        print_type = PrintType(key="test_color", label="Test Color", color_mode="color")
        product = Product(name="Presentation print", service=service, print_type_definition=print_type, operation_kind="printing")
        db.add_all([profile, customer, service, print_type, product])
        db.commit()
        customer_id, product_id = customer.id, product.id

    def override_db():
        with session() as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(quotations.router)
    app.include_router(job_orders.router)
    return TestClient(app), session, customer_id, product_id


def test_quotation_generation_exports_without_persistence(tmp_path) -> None:
    client, session, _, product_id = _setup(tmp_path)
    headers = {"X-Print-MS-Token": settings.token}
    payload = {
        "customerName": "Walk-in prospect",
        "customerContact": "prospect@example.com | 0917 555 0100",
        "validUntil": (date.today() + timedelta(days=14)).isoformat(),
        "notes": "Fifty percent deposit before production.",
        "items": [{"productId": product_id, "quantity": 2, "unitPrice": 125}],
    }
    pdf_response = client.post("/quotations/document?format=pdf", headers=headers, json=payload)
    assert pdf_response.status_code == 200
    document = pymupdf.open(stream=pdf_response.content, filetype="pdf")
    try:
        assert document.page_count == 1
        text = document[0].get_text()
        assert "QUOTATION" in text
        assert "Walk-in prospect" in text
        assert "prospect@example.com" in text
        assert "PHP 250.00" in text
    finally:
        document.close()

    image_response = client.post("/quotations/document?format=png", headers=headers, json=payload)
    assert image_response.status_code == 200
    image = Image.open(BytesIO(image_response.content))
    try:
        assert image.width > 1000
        assert image.height > image.width
    finally:
        image.close()
    with session() as db:
        assert db.query(Quotation).count() == 0


def test_job_order_receipt_includes_discount_and_payment(tmp_path) -> None:
    client, session, customer_id, product_id = _setup(tmp_path)
    with session() as db:
        order = JobOrder(
            number="JOB-0000000001", name="Customer presentation", customer_id=customer_id,
            total=225, discount_name="Wholesale", discount_calculation_type="percentage",
            discount_value=10, discount_amount=25,
        )
        order.items.append(JobOrderItem(product_id=product_id, pages_per_copy=10, copies=2, unit_price=12.5, line_total=250))
        order.payments.append(Payment(amount=225, verified=True))
        db.add(order)
        db.commit()
        order_id = order.id
    headers = {"X-Print-MS-Token": settings.token}
    response = client.get(f"/job-orders/{order_id}/receipt?format=pdf", headers=headers)
    assert response.status_code == 200, response.text
    document = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        text = "\n".join(page.get_text() for page in document)
        assert "RECEIPT" in text
        assert "Wholesale" in text
        assert "PHP 225.00" in text
        assert "PAID" in text
    finally:
        document.close()
