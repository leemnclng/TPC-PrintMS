from __future__ import annotations

from ..models.enums import Orientation, PaperSize

KNOWN_SIZES_MM = {
    PaperSize.a3: (297.0, 420.0),
    PaperSize.a4: (210.0, 297.0),
    PaperSize.letter: (215.9, 279.4),
    PaperSize.legal: (215.9, 355.6),
}


def classify_paper_size(width_mm: float | None, height_mm: float | None) -> PaperSize:
    if not width_mm or not height_mm:
        return PaperSize.unknown
    short, long = sorted((width_mm, height_mm))
    for paper_size, dimensions in KNOWN_SIZES_MM.items():
        expected_short, expected_long = sorted(dimensions)
        if abs(short - expected_short) <= 4 and abs(long - expected_long) <= 4:
            return paper_size
    return PaperSize.custom


def classify_orientation(width: float | None, height: float | None) -> Orientation:
    if not width or not height:
        return Orientation.unknown
    if abs(width - height) <= max(width, height) * 0.02:
        return Orientation.square
    return Orientation.landscape if width > height else Orientation.portrait


def points_to_mm(points: float) -> float:
    return round(points * 25.4 / 72, 1)


def emu_to_mm(emu: int) -> float:
    return round(emu / 36_000, 1)
