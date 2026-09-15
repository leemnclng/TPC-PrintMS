from io import BytesIO

import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.routers import templates


def _png(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (900, 540), color).save(output, format="PNG")
    return output.getvalue()


def test_business_card_template_generates_paired_imposed_pages() -> None:
    app = FastAPI()
    app.include_router(templates.router)
    client = TestClient(app)

    response = client.post(
        "/templates/business-card/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files={
            "front": ("front.png", _png("red"), "image/png"),
            "back": ("back.png", _png("blue"), "image/png"),
        },
        data={
            "sheet_width_mm": "210",
            "sheet_height_mm": "297",
            "card_width_mm": "90",
            "card_height_mm": "54",
            "margin_mm": "5",
            "gap_mm": "4",
            "bleed_mm": "3",
            "back_offset_x_mm": "0.3",
            "back_offset_y_mm": "-0.2",
            "crop_marks": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-template-layout"] == "2x4"
    document = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert document.page_count == 2
        assert round(document[0].rect.width * 25.4 / 72) == 210
        assert round(document[0].rect.height * 25.4 / 72) == 297
    finally:
        document.close()


def test_business_card_template_rejects_layout_that_does_not_fit() -> None:
    app = FastAPI()
    app.include_router(templates.router)
    client = TestClient(app)

    response = client.post(
        "/templates/business-card/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files={
            "front": ("front.png", _png("red"), "image/png"),
            "back": ("back.png", _png("blue"), "image/png"),
        },
        data={"card_width_mm": "220", "card_height_mm": "220", "margin_mm": "30"},
    )

    assert response.status_code == 422
    assert "does not fit" in response.json()["detail"]


def test_business_card_template_rejects_artwork_outside_safe_area() -> None:
    app = FastAPI()
    app.include_router(templates.router)
    client = TestClient(app)

    response = client.post(
        "/templates/business-card/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files={
            "front": ("front.png", _png("red"), "image/png"),
            "back": ("back.png", _png("blue"), "image/png"),
        },
        data={"front_position_x": "1.2"},
    )

    assert response.status_code == 422
    assert "safe area" in response.json()["detail"]
