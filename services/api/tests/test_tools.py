from io import BytesIO
import json

import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.routers import tools


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(tools.router)
    return TestClient(app)


def _png(size: tuple[int, int] = (120, 80)) -> bytes:
    stream = BytesIO()
    image = Image.new("RGB", size, (218, 214, 205))
    image.save(stream, format="PNG")
    image.close()
    return stream.getvalue()


def test_image_enhancer_exports_upscaled_png() -> None:
    response = _client().post(
        "/tools/enhance",
        headers={"X-Print-MS-Token": settings.token},
        files={"file": ("soft.png", _png(), "image/png")},
        data={"upscale": "2", "sharpen": "40", "auto_correct": "true"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "soft-enhanced.png" in response.headers["content-disposition"]
    result = Image.open(BytesIO(response.content))
    try:
        assert result.size == (240, 160)
        assert result.mode == "RGB"
    finally:
        result.close()


def test_pdf_enhancer_preserves_page_geometry() -> None:
    source = pymupdf.open()
    page = source.new_page(width=612, height=792)
    page.insert_text((72, 90), "Low contrast customer scan", fontsize=18, color=(.5, .5, .5))
    payload = source.tobytes()
    source.close()

    response = _client().post(
        "/tools/enhance",
        headers={"X-Print-MS-Token": settings.token},
        files={"file": ("scan.pdf", payload, "application/pdf")},
        data={"output_dpi": "150", "background_cleanup": "35", "denoise": "20", "sharpen": "30"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-enhanced-pages"] == "1"
    enhanced = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert enhanced.page_count == 1
        assert enhanced[0].rect.width == 612
        assert enhanced[0].rect.height == 792
        assert len(enhanced[0].get_images()) == 1
    finally:
        enhanced.close()


def test_enhancer_rejects_unsupported_file() -> None:
    response = _client().post(
        "/tools/enhance",
        headers={"X-Print-MS-Token": settings.token},
        files={"file": ("notes.txt", b"not artwork", "text/plain")},
    )
    assert response.status_code == 422
    assert "Choose a PDF" in response.json()["detail"]


def test_image_layout_builds_interactive_multipage_pdf() -> None:
    layout = {
        "page_width_mm": 210,
        "page_height_mm": 297,
        "pages": [
            {"items": [
                {"image_index": 0, "x": .05, "y": .05, "width": .9, "height": .42, "fit": "contain"},
                {"image_index": 1, "x": .05, "y": .52, "width": .9, "height": .43, "fit": "cover"},
            ]},
            {"items": [{"image_index": 0, "x": .1, "y": .1, "width": .8, "height": .8, "fit": "cover"}]},
        ],
    }
    response = _client().post(
        "/tools/image-layout/pdf",
        headers={"X-Print-MS-Token": settings.token},
        files=[
            ("files", ("first.png", _png((160, 90)), "image/png")),
            ("files", ("second.png", _png((90, 160)), "image/png")),
        ],
        data={"layout_json": json.dumps(layout)},
    )
    assert response.status_code == 200, response.text
    assert response.headers["x-layout-pages"] == "2"
    document = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert document.page_count == 2
        assert round(document[0].rect.width, 1) == round(210 * 72 / 25.4, 1)
        assert round(document[0].rect.height, 1) == round(297 * 72 / 25.4, 1)
        assert len(document[0].get_images()) == 2
        assert len(document[1].get_images()) == 1
    finally:
        document.close()
