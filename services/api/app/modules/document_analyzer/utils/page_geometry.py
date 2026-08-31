from __future__ import annotations

from ..models.enums import Orientation, PaperSize
from app.services.paper_sizes import PAPER_SIZE_DEFINITIONS

KNOWN_SIZES_MM: dict[PaperSize, tuple[float, float]] = {
    PaperSize.a3: (297.0, 420.0),
}
KNOWN_SIZES_MM.update({
    PaperSize(definition.key.value): (definition.width_mm, definition.height_mm)
    for definition in PAPER_SIZE_DEFINITIONS
    if definition.width_mm is not None and definition.height_mm is not None
})


def classify_paper_size(width_mm: float | None, height_mm: float | None) -> PaperSize:
    if not width_mm or not height_mm:
        return PaperSize.unknown
    short, long = sorted((width_mm, height_mm))
    candidates: list[tuple[float, PaperSize]] = []
    for paper_size, dimensions in KNOWN_SIZES_MM.items():
        expected_short, expected_long = sorted(dimensions)
        difference = abs(short - expected_short) + abs(long - expected_long)
        if abs(short - expected_short) <= 4 and abs(long - expected_long) <= 4:
            candidates.append((difference, paper_size))
    if candidates:
        return min(candidates, key=lambda candidate: candidate[0])[1]
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
