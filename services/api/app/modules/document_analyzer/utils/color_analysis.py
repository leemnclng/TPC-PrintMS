from __future__ import annotations

from dataclasses import dataclass

from PIL import Image


@dataclass(frozen=True)
class ImageColorMetrics:
    is_colored: bool
    coverage_percent: float
    ink_coverage_percent: float


def analyze_image_color(image: Image.Image) -> ImageColorMetrics:
    sample = image.convert("RGB")
    sample.thumbnail((320, 320))
    pixels = list(sample.get_flattened_data())
    if not pixels:
        return ImageColorMetrics(False, 0.0, 0.0)

    non_white = 0
    colored = 0
    darkness = 0.0
    for red, green, blue in pixels:
        if min(red, green, blue) < 245:
            non_white += 1
            if max(red, green, blue) - min(red, green, blue) >= 14:
                colored += 1
        darkness += 1 - ((red + green + blue) / 765)

    total = len(pixels)
    return ImageColorMetrics(
        is_colored=colored / total >= 0.002,
        coverage_percent=round(non_white / total * 100, 1),
        ink_coverage_percent=round(darkness / total * 100, 1),
    )
