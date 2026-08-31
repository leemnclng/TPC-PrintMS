from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..db.models import InventoryPaperSize


PaperSizeGroup = Literal["document", "photo", "envelope", "card", "custom"]


@dataclass(frozen=True)
class PaperSizeDefinition:
    key: InventoryPaperSize
    label: str
    width_mm: float | None
    height_mm: float | None
    group: PaperSizeGroup
    cups_name: str | None = None
    windows_aliases: tuple[str, ...] = ()


PAPER_SIZE_DEFINITIONS = (
    PaperSizeDefinition(InventoryPaperSize.letter, "Letter", 215.9, 279.4, "document", "na_letter_8.5x11in", ("Letter",)),
    PaperSizeDefinition(InventoryPaperSize.legal, "Legal", 215.9, 355.6, "document", "na_legal_8.5x14in", ("Legal",)),
    PaperSizeDefinition(InventoryPaperSize.executive, "Executive", 184.2, 266.7, "document", "na_executive_7.25x10.5in", ("Executive",)),
    PaperSizeDefinition(InventoryPaperSize.a6, "A6", 105.0, 148.0, "document", "iso_a6_105x148mm", ("A6",)),
    PaperSizeDefinition(InventoryPaperSize.a5, "A5", 148.0, 210.0, "document", "iso_a5_148x210mm", ("A5",)),
    PaperSizeDefinition(InventoryPaperSize.a4, "A4", 210.0, 297.0, "document", "iso_a4_210x297mm", ("A4",)),
    PaperSizeDefinition(InventoryPaperSize.b5, "B5", 182.0, 257.0, "document", "jis_b5_182x257mm", ("B5", "JIS B5")),
    PaperSizeDefinition(InventoryPaperSize.b_oficio, "B-Oficio", 216.0, 355.0, "document", windows_aliases=("B-Oficio",)),
    PaperSizeDefinition(InventoryPaperSize.m_oficio, "M-Oficio", 216.0, 341.0, "document", windows_aliases=("M-Oficio",)),
    PaperSizeDefinition(InventoryPaperSize.foolscap, "Foolscap/F4/Oficio2", 215.9, 330.2, "document", windows_aliases=("Foolscap", "F4", "Oficio2", "FC/F4/Ofc2")),
    PaperSizeDefinition(InventoryPaperSize.legal_india, "Legal (India)", 215.0, 345.0, "document", windows_aliases=("Legal (India)",)),
    PaperSizeDefinition(InventoryPaperSize.photo_4x6, '4"x6"', 101.6, 152.4, "photo", "na_index-4x6_4x6in", ('4x6', '4" x 6"', "10x15cm")),
    PaperSizeDefinition(InventoryPaperSize.photo_5x7, '5"x7"', 127.0, 177.8, "photo", "na_5x7_5x7in", ('5x7', '5" x 7"', "13x18cm")),
    PaperSizeDefinition(InventoryPaperSize.photo_7x10, '7"x10"', 177.8, 254.0, "photo", windows_aliases=('7x10', '7" x 10"', "18x25cm")),
    PaperSizeDefinition(InventoryPaperSize.photo_8x10, '8"x10"', 203.2, 254.0, "photo", "na_govt-letter_8x10in", ('8x10', '8" x 10"', "20x25cm")),
    PaperSizeDefinition(InventoryPaperSize.photo_l, "L", 89.0, 127.0, "photo", windows_aliases=("L", "L 89x127mm")),
    PaperSizeDefinition(InventoryPaperSize.photo_2l, "2L", 127.0, 178.0, "photo", windows_aliases=("2L", "2L 127x178mm")),
    PaperSizeDefinition(InventoryPaperSize.square_3_5, 'Square 3.5"x3.5"', 88.9, 88.9, "photo", windows_aliases=("Square 3.5", "Square 9cm")),
    PaperSizeDefinition(InventoryPaperSize.square_5, 'Square 5"x5"', 127.0, 127.0, "photo", windows_aliases=("Square 5", "Square 13cm")),
    PaperSizeDefinition(InventoryPaperSize.hagaki, "Hagaki", 100.0, 148.0, "card", "jpn_hagaki_100x148mm", ("Hagaki",)),
    PaperSizeDefinition(InventoryPaperSize.hagaki_2, "Hagaki 2", 148.0, 200.0, "card", "jpn_oufuku_148x200mm", ("Hagaki 2", "Oufuku")),
    PaperSizeDefinition(InventoryPaperSize.envelope_com10, "Envelope #10", 104.8, 241.3, "envelope", "na_number-10_4.125x9.5in", ("Envelope #10", "Envelope Com 10", "Number 10")),
    PaperSizeDefinition(InventoryPaperSize.envelope_dl, "Envelope DL", 110.0, 220.0, "envelope", "iso_dl_110x220mm", ("Envelope DL", "DL")),
    PaperSizeDefinition(InventoryPaperSize.nagagata_3, "Nagagata 3", 120.0, 235.0, "envelope", "jpn_chou3_120x235mm", ("Nagagata 3", "Chou 3")),
    PaperSizeDefinition(InventoryPaperSize.nagagata_4, "Nagagata 4", 90.0, 205.0, "envelope", "jpn_chou4_90x205mm", ("Nagagata 4", "Chou 4")),
    PaperSizeDefinition(InventoryPaperSize.yougata_4, "Yougata 4", 105.0, 235.0, "envelope", None, ("Yougata 4",)),
    PaperSizeDefinition(InventoryPaperSize.yougata_6, "Yougata 6", 98.0, 190.0, "envelope", None, ("Yougata 6",)),
    PaperSizeDefinition(InventoryPaperSize.envelope_c5, "Envelope C5", 162.0, 229.0, "envelope", "iso_c5_162x229mm", ("Envelope C5", "C5")),
    PaperSizeDefinition(InventoryPaperSize.envelope_monarch, "Envelope Monarch", 98.4, 190.5, "envelope", "na_monarch_3.875x7.5in", ("Envelope Monarch", "Monarch")),
    PaperSizeDefinition(InventoryPaperSize.card, "Card", 55.0, 91.0, "card", windows_aliases=("Card", "Card 55x91mm")),
    PaperSizeDefinition(InventoryPaperSize.custom, "Custom size", None, None, "custom"),
)

PAPER_SIZE_BY_KEY = {definition.key: definition for definition in PAPER_SIZE_DEFINITIONS}


def paper_size_definition(value: InventoryPaperSize | str) -> PaperSizeDefinition:
    key = value if isinstance(value, InventoryPaperSize) else InventoryPaperSize(value)
    return PAPER_SIZE_BY_KEY[key]


def canonical_paper_dimensions(
    paper_size: InventoryPaperSize,
    width_mm: float | None,
    height_mm: float | None,
) -> tuple[float, float]:
    definition = paper_size_definition(paper_size)
    if paper_size is not InventoryPaperSize.custom:
        assert definition.width_mm is not None and definition.height_mm is not None
        return definition.width_mm, definition.height_mm
    if width_mm is None or height_mm is None:
        raise ValueError("Enter both width and height for a custom paper size.")
    short, long = sorted((round(width_mm, 1), round(height_mm, 1)))
    if short < 55.0 or long < 89.0 or short > 216.0 or long > 1200.0:
        raise ValueError("Custom paper must be between 55 × 89 mm and 216 × 1200 mm.")
    return short, long


def paper_size_display(
    paper_size: InventoryPaperSize,
    width_mm: float | None = None,
    height_mm: float | None = None,
) -> str:
    definition = paper_size_definition(paper_size)
    width = definition.width_mm if definition.width_mm is not None else width_mm
    height = definition.height_mm if definition.height_mm is not None else height_mm
    return f"{definition.label} · {width:g} × {height:g} mm" if width and height else definition.label


def cups_media_size(
    paper_size: InventoryPaperSize | str,
    width_mm: float,
    height_mm: float,
) -> str:
    definition = paper_size_definition(paper_size)
    if definition.cups_name:
        return definition.cups_name
    return f"Custom.{width_mm:g}x{height_mm:g}mm"
