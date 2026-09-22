from io import BytesIO

import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.routers import templates


def _png(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (900, 540), color).save(output, format="PNG")
    return output.getvalue()


def _split_png() -> bytes:
    output = BytesIO()
    image = Image.new("RGB", (900, 540), "red")
    image.paste(Image.new("RGB", (900, 270), "blue"), (0, 270))
    image.save(output, format="PNG")
    image.close()
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
            "back_offset_x_mm": "0",
            "back_offset_y_mm": "0",
            "crop_marks": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-template-layout"] == "2x4"
    assert response.headers["x-duplex-mode"] == "manual"
    document = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert document.page_count == 2
        assert round(document[0].rect.width * 25.4 / 72) == 210
        assert round(document[0].rect.height * 25.4 / 72) == 297
        front_boxes = sorted(tuple(item["bbox"]) for item in document[0].get_image_info())
        back_boxes = sorted(tuple(item["bbox"]) for item in document[1].get_image_info())
        assert len(front_boxes) == len(back_boxes) == 8
        for front_box, back_box in zip(front_boxes, back_boxes, strict=True):
            assert back_box == pytest.approx(front_box)
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


def test_business_card_can_auto_rotate_the_back_page() -> None:
    app = FastAPI()
    app.include_router(templates.router)
    response = TestClient(app).post(
        "/templates/business-card/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files={"front": ("front.png", _png("red"), "image/png"), "back": ("back.png", _split_png(), "image/png")},
        data={"manual_duplex": "false", "crop_marks": "false"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["x-duplex-mode"] == "automatic"


def test_trifold_brochure_defaults_to_manual_and_can_auto_rotate_inside() -> None:
    app = FastAPI()
    app.include_router(templates.router)
    client = TestClient(app)
    files = {"outside": ("outside.png", _png("white"), "image/png"), "inside": ("inside.png", _split_png(), "image/png")}
    manual = client.post(
        "/templates/trifold-brochure/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files=files,
        data={"fold_marks": "false"},
    )
    automatic = client.post(
        "/templates/trifold-brochure/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files=files,
        data={"fold_marks": "false", "manual_duplex": "false"},
    )
    assert manual.status_code == automatic.status_code == 200
    assert manual.headers["x-duplex-mode"] == "manual"
    assert automatic.headers["x-duplex-mode"] == "automatic"
    manual_pdf = pymupdf.open(stream=manual.content, filetype="pdf")
    automatic_pdf = pymupdf.open(stream=automatic.content, filetype="pdf")
    try:
        assert manual_pdf.page_count == automatic_pdf.page_count == 2
        assert round(manual_pdf[0].rect.width * 25.4 / 72) == 297
        assert round(manual_pdf[0].rect.height * 25.4 / 72) == 210
        manual_pixmap = manual_pdf[1].get_pixmap(dpi=72, colorspace=pymupdf.csRGB)
        automatic_pixmap = automatic_pdf[1].get_pixmap(dpi=72, colorspace=pymupdf.csRGB)
        top = (manual_pixmap.width // 2, 100)
        assert manual_pixmap.pixel(*top) != automatic_pixmap.pixel(*top)
    finally:
        manual_pdf.close()
        automatic_pdf.close()
