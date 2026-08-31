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
    letter = "Letter"
    legal = "Legal"
    executive = "Executive"
    a6 = "A6"
    a5 = "A5"
    a4 = "A4"
    b5 = "B5"
    b_oficio = "B-Oficio"
    m_oficio = "M-Oficio"
    foolscap = "Foolscap/F4/Oficio2"
    legal_india = "Legal (India)"
    photo_4x6 = '4"x6"'
    photo_5x7 = '5"x7"'
    photo_7x10 = '7"x10"'
    photo_8x10 = '8"x10"'
    photo_l = "L"
    photo_2l = "2L"
    square_3_5 = 'Square 3.5"x3.5"'
    square_5 = 'Square 5"x5"'
    hagaki = "Hagaki"
    hagaki_2 = "Hagaki 2"
    envelope_com10 = "Envelope #10"
    envelope_dl = "Envelope DL"
    nagagata_3 = "Nagagata 3"
    nagagata_4 = "Nagagata 4"
    yougata_4 = "Yougata 4"
    yougata_6 = "Yougata 6"
    envelope_c5 = "Envelope C5"
    envelope_monarch = "Envelope Monarch"
    card = "Card 55x91mm"
    custom = "Custom"
    unknown = "Unknown"


class Orientation(str, Enum):
    portrait = "portrait"
    landscape = "landscape"
    square = "square"
    mixed = "mixed"
    unknown = "unknown"
