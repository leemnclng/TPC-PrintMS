from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from ..core.security import require_token


router = APIRouter(prefix="/templates", tags=["templates"], dependencies=[Depends(require_token)])

MAX_ARTWORK_BYTES = 25 * 1024 * 1024
SUPPORTED_ARTWORK_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
MM_TO_POINTS = 72 / 25.4


def _single_page_pdf(filename: str, data: bytes) -> pymupdf.Document:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_ARTWORK_SUFFIXES:
        raise ValueError("Artwork must be a single-page PDF or image file.")
    source = pymupdf.open(stream=data, filetype=suffix.removeprefix("."))
    if source.page_count != 1:
        source.close()
        raise ValueError(f"{filename} must contain exactly one page.")
    if suffix == ".pdf":
        return source
    try:
        converted = source.convert_to_pdf()
    finally:
        source.close()
    return pymupdf.open(stream=converted, filetype="pdf")


def _draw_crop_marks(page: pymupdf.Page, rect: pymupdf.Rect, mark_length: float, gap: float) -> None:
    color = (0.15, 0.12, 0.1)
    width = 0.35
    segments = (
        ((rect.x0 - gap - mark_length, rect.y0), (rect.x0 - gap, rect.y0)),
        ((rect.x0, rect.y0 - gap - mark_length), (rect.x0, rect.y0 - gap)),
        ((rect.x1 + gap, rect.y0), (rect.x1 + gap + mark_length, rect.y0)),
        ((rect.x1, rect.y0 - gap - mark_length), (rect.x1, rect.y0 - gap)),
        ((rect.x0 - gap - mark_length, rect.y1), (rect.x0 - gap, rect.y1)),
        ((rect.x0, rect.y1 + gap), (rect.x0, rect.y1 + gap + mark_length)),
        ((rect.x1 + gap, rect.y1), (rect.x1 + gap + mark_length, rect.y1)),
        ((rect.x1, rect.y1 + gap), (rect.x1, rect.y1 + gap + mark_length)),
    )
    for start, end in segments:
        page.draw_line(start, end, color=color, width=width)


def _build_card_canvas(
    source: pymupdf.Document,
    slot_width_mm: float,
    slot_height_mm: float,
    card_width_mm: float,
    card_height_mm: float,
    bleed_mm: float,
    safe_margin_mm: float,
    position_x: float,
    position_y: float,
    scale_percent: float,
) -> pymupdf.Document:
    canvas = pymupdf.open()
    page = canvas.new_page(width=slot_width_mm * MM_TO_POINTS, height=slot_height_mm * MM_TO_POINTS)
    safe = pymupdf.Rect(
        (bleed_mm + safe_margin_mm) * MM_TO_POINTS,
        (bleed_mm + safe_margin_mm) * MM_TO_POINTS,
        (bleed_mm + card_width_mm - safe_margin_mm) * MM_TO_POINTS,
        (bleed_mm + card_height_mm - safe_margin_mm) * MM_TO_POINTS,
    )
    source_rect = source[0].rect
    width = safe.width * (scale_percent / 100)
    height = width * (source_rect.height / source_rect.width)
    if height > safe.height:
        height = safe.height
        width = height * (source_rect.width / source_rect.height)
    x = safe.x0 + max(0, safe.width - width) * position_x
    y = safe.y0 + max(0, safe.height - height) * position_y
    page.show_pdf_page(pymupdf.Rect(x, y, x + width, y + height), source, 0, keep_proportion=True)
    return canvas


def _build_business_card_pdf(
    front_data: bytes,
    front_name: str,
    back_data: bytes,
    back_name: str,
    sheet_width_mm: float,
    sheet_height_mm: float,
    card_width_mm: float,
    card_height_mm: float,
    margin_mm: float,
    gap_mm: float,
    bleed_mm: float,
    back_offset_x_mm: float,
    back_offset_y_mm: float,
    crop_marks: bool,
    safe_margin_mm: float = 4,
    front_position_x: float = 0.5,
    front_position_y: float = 0.5,
    front_scale_percent: float = 70,
    back_position_x: float = 0.5,
    back_position_y: float = 0.5,
    back_scale_percent: float = 70,
) -> tuple[bytes, int, int]:
    values = (sheet_width_mm, sheet_height_mm, card_width_mm, card_height_mm, margin_mm, gap_mm, bleed_mm)
    if any(not isinstance(value, (int, float)) for value in values):
        raise ValueError("Layout dimensions must be numeric.")
    if not (100 <= sheet_width_mm <= 1200 and 100 <= sheet_height_mm <= 1200):
        raise ValueError("Sheet dimensions must be between 100 and 1200 mm.")
    if not (40 <= card_width_mm <= 220 and 25 <= card_height_mm <= 220):
        raise ValueError("Card dimensions must be between 40 × 25 mm and 220 × 220 mm.")
    if margin_mm < 0 or gap_mm < 0 or bleed_mm < 0 or bleed_mm > 10:
        raise ValueError("Margins, gaps, and bleed must use valid non-negative dimensions.")
    if abs(back_offset_x_mm) > 10 or abs(back_offset_y_mm) > 10:
        raise ValueError("Back-side calibration offsets must stay within ±10 mm.")
    if safe_margin_mm < 0 or safe_margin_mm * 2 >= min(card_width_mm, card_height_mm):
        raise ValueError("The safe margin must leave a usable area inside the finished card.")
    placements = (
        front_position_x,
        front_position_y,
        back_position_x,
        back_position_y,
    )
    if any(value < 0 or value > 1 for value in placements):
        raise ValueError("Artwork positions must stay inside the safe area.")
    if not (10 <= front_scale_percent <= 100 and 10 <= back_scale_percent <= 100):
        raise ValueError("Artwork scale must be between 10% and 100%.")

    slot_width = card_width_mm + (2 * bleed_mm)
    slot_height = card_height_mm + (2 * bleed_mm)
    columns = int((sheet_width_mm - (2 * margin_mm) + gap_mm) // (slot_width + gap_mm))
    rows = int((sheet_height_mm - (2 * margin_mm) + gap_mm) // (slot_height + gap_mm))
    if columns < 1 or rows < 1:
        raise ValueError("The card does not fit on the selected sheet with these margins and bleed settings.")
    if columns * rows > 100:
        raise ValueError("A template may contain at most 100 cards per sheet.")

    grid_width = (columns * slot_width) + ((columns - 1) * gap_mm)
    grid_height = (rows * slot_height) + ((rows - 1) * gap_mm)
    origin_x = (sheet_width_mm - grid_width) / 2
    origin_y = (sheet_height_mm - grid_height) / 2
    front_source = _single_page_pdf(front_name, front_data)
    back_source = _single_page_pdf(back_name, back_data)
    front_canvas = _build_card_canvas(front_source, slot_width, slot_height, card_width_mm, card_height_mm, bleed_mm, safe_margin_mm, front_position_x, front_position_y, front_scale_percent)
    back_canvas = _build_card_canvas(back_source, slot_width, slot_height, card_width_mm, card_height_mm, bleed_mm, safe_margin_mm, back_position_x, back_position_y, back_scale_percent)
    output = pymupdf.open()
    try:
        for side, source in (("front", front_canvas), ("back", back_canvas)):
            page = output.new_page(width=sheet_width_mm * MM_TO_POINTS, height=sheet_height_mm * MM_TO_POINTS)
            for row in range(rows):
                for column in range(columns):
                    x = origin_x + column * (slot_width + gap_mm)
                    y = origin_y + row * (slot_height + gap_mm)
                    rotation = 0
                    if side == "back":
                        # Matches OMS's supervised rear-tray instruction: rotate
                        # the complete sheet 180° before the back pass.
                        x = sheet_width_mm - x - slot_width + back_offset_x_mm
                        y = sheet_height_mm - y - slot_height + back_offset_y_mm
                        rotation = 180
                    artwork = pymupdf.Rect(
                        x * MM_TO_POINTS,
                        y * MM_TO_POINTS,
                        (x + slot_width) * MM_TO_POINTS,
                        (y + slot_height) * MM_TO_POINTS,
                    )
                    page.show_pdf_page(artwork, source, 0, rotate=rotation, keep_proportion=True)
                    if crop_marks:
                        trim = pymupdf.Rect(
                            (x + bleed_mm) * MM_TO_POINTS,
                            (y + bleed_mm) * MM_TO_POINTS,
                            (x + bleed_mm + card_width_mm) * MM_TO_POINTS,
                            (y + bleed_mm + card_height_mm) * MM_TO_POINTS,
                        )
                        _draw_crop_marks(page, trim, 3 * MM_TO_POINTS, 0.7 * MM_TO_POINTS)
        return output.tobytes(garbage=4, deflate=True), columns, rows
    finally:
        front_source.close()
        back_source.close()
        front_canvas.close()
        back_canvas.close()
        output.close()


@router.post("/business-card/pdf")
async def create_business_card_pdf(
    front: UploadFile = File(...),
    back: UploadFile = File(...),
    sheet_width_mm: float = Form(210),
    sheet_height_mm: float = Form(297),
    card_width_mm: float = Form(90),
    card_height_mm: float = Form(54),
    margin_mm: float = Form(5),
    gap_mm: float = Form(4),
    bleed_mm: float = Form(3),
    back_offset_x_mm: float = Form(0),
    back_offset_y_mm: float = Form(0),
    crop_marks: bool = Form(True),
    safe_margin_mm: float = Form(4),
    front_position_x: float = Form(0.5),
    front_position_y: float = Form(0.5),
    front_scale_percent: float = Form(70),
    back_position_x: float = Form(0.5),
    back_position_y: float = Form(0.5),
    back_scale_percent: float = Form(70),
) -> Response:
    front_data = await front.read(MAX_ARTWORK_BYTES + 1)
    back_data = await back.read(MAX_ARTWORK_BYTES + 1)
    await front.close()
    await back.close()
    if not front_data or not back_data:
        raise HTTPException(status_code=422, detail="Choose non-empty front and back artwork files.")
    if len(front_data) > MAX_ARTWORK_BYTES or len(back_data) > MAX_ARTWORK_BYTES:
        raise HTTPException(status_code=413, detail="Each artwork file must be 25 MB or smaller.")
    try:
        content, columns, rows = await run_in_threadpool(
            _build_business_card_pdf,
            front_data,
            Path(front.filename or "front").name,
            back_data,
            Path(back.filename or "back").name,
            sheet_width_mm,
            sheet_height_mm,
            card_width_mm,
            card_height_mm,
            margin_mm,
            gap_mm,
            bleed_mm,
            back_offset_x_mm,
            back_offset_y_mm,
            crop_marks,
            safe_margin_mm,
            front_position_x,
            front_position_y,
            front_scale_percent,
            back_position_x,
            back_position_y,
            back_scale_percent,
        )
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="business-card-print-ready.pdf"',
            "X-Template-Layout": f"{columns}x{rows}",
        },
    )
