from __future__ import annotations

from io import BytesIO
from math import ceil
from pathlib import Path

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from ..core.security import require_token


router = APIRouter(prefix="/tools", tags=["tools"], dependencies=[Depends(require_token)])

MAX_SOURCE_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 30
MAX_PAGE_PIXELS = 40_000_000
MAX_TOTAL_PIXELS = 160_000_000
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def _flatten_to_rgb(image: Image.Image) -> Image.Image:
    oriented = ImageOps.exif_transpose(image)
    if oriented.mode in {"RGBA", "LA"} or "transparency" in oriented.info:
        rgba = oriented.convert("RGBA")
        result = Image.new("RGB", rgba.size, "white")
        result.paste(rgba, mask=rgba.getchannel("A"))
        rgba.close()
        if oriented is not image:
            oriented.close()
        return result
    result = oriented.convert("RGB")
    if oriented is not image:
        oriented.close()
    return result


def _replace_image(current: Image.Image, replacement: Image.Image) -> Image.Image:
    current.close()
    return replacement


def _enhance_image(
    source: Image.Image,
    *,
    brightness: int,
    contrast: int,
    saturation: int,
    warmth: int,
    sharpen: int,
    denoise: int,
    background_cleanup: int,
    auto_correct: bool,
    grayscale: bool,
    upscale: int,
) -> Image.Image:
    result = _flatten_to_rgb(source)
    if upscale > 1:
        size = (result.width * upscale, result.height * upscale)
        if size[0] * size[1] > MAX_PAGE_PIXELS:
            result.close()
            raise ValueError("The selected resolution would exceed the 40-megapixel per-page safety limit.")
        result = _replace_image(result, result.resize(size, Image.Resampling.LANCZOS))
    if denoise:
        filter_size = 3 if denoise < 65 else 5
        result = _replace_image(result, result.filter(ImageFilter.MedianFilter(filter_size)))
    if auto_correct:
        result = _replace_image(result, ImageOps.autocontrast(result, cutoff=1, preserve_tone=True))
    if background_cleanup:
        threshold = round(252 - (background_cleanup * 0.58))
        luminance = ImageOps.grayscale(result)
        mask = luminance.point(lambda value: 255 if value >= threshold else 0)
        luminance.close()
        if background_cleanup < 70:
            mask = _replace_image(mask, mask.filter(ImageFilter.GaussianBlur(radius=0.6)))
        white = Image.new("RGB", result.size, "white")
        cleaned = Image.composite(white, result, mask)
        white.close()
        mask.close()
        result = _replace_image(result, cleaned)
    if brightness:
        result = _replace_image(result, ImageEnhance.Brightness(result).enhance(max(0, 1 + brightness / 100)))
    if contrast:
        result = _replace_image(result, ImageEnhance.Contrast(result).enhance(max(0, 1 + contrast / 100)))
    if saturation and not grayscale:
        result = _replace_image(result, ImageEnhance.Color(result).enhance(max(0, 1 + saturation / 100)))
    if warmth and not grayscale:
        red_source, green, blue_source = result.split()
        shift = warmth / 100
        red = red_source.point(lambda value: max(0, min(255, round(value * (1 + .18 * shift)))))
        blue = blue_source.point(lambda value: max(0, min(255, round(value * (1 - .18 * shift)))))
        warmed = Image.merge("RGB", (red, green, blue))
        for channel in (red_source, green, blue_source, red, blue):
            channel.close()
        result = _replace_image(result, warmed)
    if sharpen:
        result = _replace_image(result, result.filter(ImageFilter.UnsharpMask(radius=1.2 + sharpen / 80, percent=50 + sharpen * 2, threshold=3)))
    if grayscale:
        gray = ImageOps.grayscale(result)
        converted = gray.convert("RGB")
        gray.close()
        result = _replace_image(result, converted)
    return result


def _png_bytes(image: Image.Image, dpi: int) -> bytes:
    stream = BytesIO()
    image.save(stream, format="PNG", optimize=True, dpi=(dpi, dpi))
    return stream.getvalue()


def _build_enhanced_file(
    filename: str,
    data: bytes,
    brightness: int,
    contrast: int,
    saturation: int,
    warmth: int,
    sharpen: int,
    denoise: int,
    background_cleanup: int,
    auto_correct: bool,
    grayscale: bool,
    output_dpi: int,
    upscale: int,
) -> tuple[bytes, str, str, int]:
    suffix = Path(filename).suffix.lower()
    if suffix != ".pdf" and suffix not in IMAGE_SUFFIXES:
        raise ValueError("Choose a PDF, PNG, JPEG, WebP, BMP, or TIFF file.")
    if output_dpi not in {150, 300} or upscale not in {1, 2}:
        raise ValueError("Choose a supported output resolution and upscale value.")
    options = dict(
        brightness=brightness, contrast=contrast, saturation=saturation, warmth=warmth,
        sharpen=sharpen, denoise=denoise, background_cleanup=background_cleanup,
        auto_correct=auto_correct, grayscale=grayscale, upscale=upscale,
    )
    stem = Path(filename).stem or "document"
    if suffix == ".pdf":
        source = pymupdf.open(stream=data, filetype="pdf")
        output = pymupdf.open()
        try:
            if source.needs_pass:
                raise ValueError("Password-protected PDFs cannot be enhanced.")
            if source.page_count < 1:
                raise ValueError("The PDF has no pages.")
            if source.page_count > MAX_PDF_PAGES:
                raise ValueError(f"PDF enhancement supports up to {MAX_PDF_PAGES} pages at a time.")
            total_pixels = 0
            render_dpi = output_dpi
            for page in source:
                expected_width = ceil(page.rect.width * render_dpi / 72) * upscale
                expected_height = ceil(page.rect.height * render_dpi / 72) * upscale
                expected_pixels = expected_width * expected_height
                if expected_pixels > MAX_PAGE_PIXELS:
                    raise ValueError("A PDF page would exceed the 40-megapixel safety limit at this resolution.")
                total_pixels += expected_pixels
                if total_pixels > MAX_TOTAL_PIXELS:
                    raise ValueError("This PDF is too large at the selected resolution. Reduce DPI or upscale and try again.")
                pixmap = page.get_pixmap(dpi=render_dpi, colorspace=pymupdf.csRGB, alpha=False, annots=True)
                image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                enhanced = _enhance_image(image, **options)
                image.close()
                try:
                    page_output = output.new_page(width=page.rect.width, height=page.rect.height)
                    page_output.insert_image(page_output.rect, stream=_png_bytes(enhanced, render_dpi * upscale))
                finally:
                    enhanced.close()
            return output.tobytes(garbage=4, deflate=True), "application/pdf", f"{stem}-enhanced.pdf", source.page_count
        finally:
            source.close()
            output.close()
    try:
        source_image = Image.open(BytesIO(data))
        if source_image.width * source_image.height * upscale * upscale > MAX_PAGE_PIXELS:
            raise ValueError("The selected upscale would exceed the 40-megapixel safety limit.")
        try:
            enhanced = _enhance_image(source_image, **options)
            try:
                return _png_bytes(enhanced, output_dpi), "image/png", f"{stem}-enhanced.png", 1
            finally:
                enhanced.close()
        finally:
            source_image.close()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("The image could not be opened.") from error


@router.post("/enhance")
async def enhance_file(
    file: UploadFile = File(...),
    brightness: int = Form(0, ge=-50, le=50),
    contrast: int = Form(0, ge=-50, le=50),
    saturation: int = Form(0, ge=-100, le=100),
    warmth: int = Form(0, ge=-100, le=100),
    sharpen: int = Form(0, ge=0, le=100),
    denoise: int = Form(0, ge=0, le=100),
    background_cleanup: int = Form(0, ge=0, le=100),
    auto_correct: bool = Form(False),
    grayscale: bool = Form(False),
    output_dpi: int = Form(300),
    upscale: int = Form(1),
) -> Response:
    data = await file.read(MAX_SOURCE_BYTES + 1)
    filename = Path(file.filename or "source").name
    await file.close()
    if not data:
        raise HTTPException(status_code=422, detail="Choose a non-empty PDF or image.")
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="Files must be 25 MB or smaller.")
    try:
        content, media_type, output_name, page_count = await run_in_threadpool(
            _build_enhanced_file,
            filename, data, brightness, contrast, saturation, warmth, sharpen, denoise,
            background_cleanup, auto_correct, grayscale, output_dpi, upscale,
        )
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{output_name}"',
            "X-Enhanced-Pages": str(page_count),
        },
    )
