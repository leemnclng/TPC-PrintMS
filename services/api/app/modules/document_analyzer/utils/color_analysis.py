from __future__ import annotations

from dataclasses import dataclass

from PIL import Image


@dataclass(frozen=True)
class ImageColorMetrics:
    is_colored: bool
    coverage_percent: float
    color_coverage_percent: float
    ink_coverage_percent: float


def analyze_image_color(image: Image.Image) -> ImageColorMetrics:
    sample = image.convert("RGB")
    sample.thumbnail((320, 320))
    pixels = list(sample.get_flattened_data())
    if not pixels:
        return ImageColorMetrics(False, 0.0, 0.0, 0.0)

    non_white = 0
    colored = 0
    ink_load = 0.0
    for red, green, blue in pixels:
        if min(red, green, blue) < 245:
            non_white += 1
            if max(red, green, blue) - min(red, green, blue) >= 14:
                colored += 1
        # The strongest RGB channel deficit is a practical 0–100 estimate
        # of how much ink a pixel asks of the printer. Unlike simple
        # luminance, it does not misclassify bright saturated yellow as
        # nearly ink-free.
        ink_load += 1 - (min(red, green, blue) / 255)

    total = len(pixels)
    return ImageColorMetrics(
        is_colored=colored / total >= 0.002,
        coverage_percent=round(non_white / total * 100, 1),
        color_coverage_percent=round(colored / total * 100, 1),
        ink_coverage_percent=round(ink_load / total * 100, 1),
    )


def estimate_text_ink_coverage(character_count: int, page_count: int) -> float:
    """Conservative fallback for Office formats that cannot be rendered.

    A dense text page is capped at 18% coverage; embedded-image coverage is
    added separately by each format analyzer. PDF and image inputs never use
    this fallback because their pixels are measured directly.
    """
    characters_per_page = character_count / max(page_count, 1)
    return round(min(18.0, characters_per_page * 0.004), 1)
