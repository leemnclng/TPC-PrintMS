from __future__ import annotations

from io import BytesIO
from statistics import mean

from PIL import Image, ImageOps


def open_image(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return ImageOps.exif_transpose(image)


def image_dpi(image: Image.Image) -> float | None:
    raw = image.info.get("dpi")
    if isinstance(raw, tuple) and raw:
        values = [float(value) for value in raw[:2] if value and float(value) > 0]
        return round(mean(values), 1) if values else None
    if isinstance(raw, (int, float)) and raw > 0:
        return round(float(raw), 1)
    return None


def physical_size_mm(image: Image.Image, dpi: float | None) -> tuple[float | None, float | None]:
    if not dpi:
        return None, None
    return round(image.width / dpi * 25.4, 1), round(image.height / dpi * 25.4, 1)
