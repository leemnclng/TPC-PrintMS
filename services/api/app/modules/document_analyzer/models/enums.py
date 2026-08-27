from __future__ import annotations

from enum import Enum


class DocumentFileType(str, Enum):
    pdf = "pdf"
    image = "image"
    docx = "docx"
    xlsx = "xlsx"
    pptx = "pptx"


class PaperSize(str, Enum):
    a3 = "A3"
    a4 = "A4"
    letter = "Letter"
    legal = "Legal"
    custom = "Custom"
    unknown = "Unknown"


class Orientation(str, Enum):
    portrait = "portrait"
    landscape = "landscape"
    square = "square"
    mixed = "mixed"
    unknown = "unknown"
