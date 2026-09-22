from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from math import ceil

import pymupdf
from PIL import Image

from ..db.models import BusinessProfile


A4_WIDTH = 595.28
A4_HEIGHT = 841.89
INK = (0.12, 0.10, 0.09)
MUTED = (0.39, 0.35, 0.32)
ACCENT = (0.39, 0.055, 0.045)
PAPER = (0.985, 0.975, 0.95)
HAIRLINE = (0.83, 0.80, 0.75)


@dataclass(frozen=True)
class SalesDocumentLine:
    label: str
    detail: str
    quantity: int
    unit_price: float
    total: float


@dataclass(frozen=True)
class SalesDocument:
    kind: str
    number: str
    customer_name: str
    issued_at: datetime
    lines: list[SalesDocumentLine]
    subtotal: float
    discount_name: str | None
    discount_amount: float
    total: float
    status: str
    notes: str | None = None
    valid_until: date | None = None
    amount_paid: float | None = None
    customer_details: str | None = None


def _safe_text(value: object) -> str:
    return str(value or "").encode("latin-1", "replace").decode("latin-1")


def _money(value: float) -> str:
    return f"PHP {value:,.2f}"


def _text(page: pymupdf.Page, point: tuple[float, float], value: object, *, size: float = 9, color=INK, font: str = "helv") -> None:
    page.insert_text(point, _safe_text(value), fontsize=size, fontname=font, color=color)


def _textbox(page: pymupdf.Page, rect: tuple[float, float, float, float], value: object, *, size: float = 9, color=INK, font: str = "helv", align: int = 0) -> None:
    page.insert_textbox(pymupdf.Rect(*rect), _safe_text(value), fontsize=size, fontname=font, color=color, align=align)


def build_sales_document_pdf(document: SalesDocument, profile: BusinessProfile | None) -> bytes:
    business_name = profile.business_name if profile else "The Paper Club"
    contact_parts = [value for value in (profile.phone if profile else None, profile.email if profile else None) if value]
    address = profile.address if profile else None
    rows_per_page = 11
    page_count = max(1, ceil(len(document.lines) / rows_per_page))
    output = pymupdf.open()
    try:
        for page_index in range(page_count):
            page = output.new_page(width=A4_WIDTH, height=A4_HEIGHT)
            page.draw_rect(page.rect, color=PAPER, fill=PAPER)
            page.draw_rect((0, 0, A4_WIDTH, 112), color=ACCENT, fill=ACCENT)
            _text(page, (42, 48), business_name.upper(), size=20, color=(1, 1, 1), font="hebo")
            _text(page, (42, 70), profile.tagline if profile and profile.tagline else "PRINTING & PAPER GOODS", size=8, color=(0.94, 0.86, 0.82))
            kind_label = document.kind.upper()
            _text(page, (553 - max(90, len(kind_label) * 14), 52), kind_label, size=22, color=(1, 1, 1), font="hebo")
            _textbox(page, (365, 66, 553, 85), document.number, size=9, color=(0.94, 0.86, 0.82), font="hebo", align=2)

            _text(page, (42, 145), "BILL TO", size=7, color=ACCENT, font="hebo")
            _text(page, (42, 169), document.customer_name, size=15, font="hebo")
            if document.customer_details:
                _textbox(page, (42, 177, 320, 207), document.customer_details, size=7.5, color=MUTED)
            _text(page, (360, 145), "ISSUED", size=7, color=ACCENT, font="hebo")
            _text(page, (360, 169), document.issued_at.strftime("%B %d, %Y"), size=10)
            _text(page, (470, 145), "STATUS", size=7, color=ACCENT, font="hebo")
            _text(page, (470, 169), document.status.replace("_", " ").upper(), size=9, font="hebo")
            if document.valid_until:
                _text(page, (360, 190), f"Valid until {document.valid_until.strftime('%B %d, %Y')}", size=8, color=MUTED)

            table_top = 220
            page.draw_rect((42, table_top, 553, table_top + 28), color=INK, fill=INK)
            _text(page, (54, table_top + 18), "DESCRIPTION", size=7, color=(1, 1, 1), font="hebo")
            _textbox(page, (350, table_top + 9, 400, table_top + 22), "QTY", size=7, color=(1, 1, 1), font="hebo", align=2)
            _textbox(page, (405, table_top + 9, 475, table_top + 22), "UNIT", size=7, color=(1, 1, 1), font="hebo", align=2)
            _textbox(page, (480, table_top + 9, 541, table_top + 22), "AMOUNT", size=7, color=(1, 1, 1), font="hebo", align=2)
            chunk = document.lines[page_index * rows_per_page:(page_index + 1) * rows_per_page]
            y = table_top + 28
            for line in chunk:
                page.draw_rect((42, y, 553, y + 34), color=HAIRLINE, fill=(1, 1, 1), width=.5)
                _text(page, (54, y + 14), line.label, size=8.5, font="hebo")
                _text(page, (54, y + 27), line.detail, size=6.8, color=MUTED)
                _textbox(page, (350, y + 11, 400, y + 26), line.quantity, size=8, align=2)
                _textbox(page, (405, y + 11, 475, y + 26), _money(line.unit_price), size=7.5, align=2)
                _textbox(page, (480, y + 11, 541, y + 26), _money(line.total), size=7.5, font="hebo", align=2)
                y += 34

            if page_index == page_count - 1:
                totals_y = max(y + 24, 645)
                _textbox(page, (350, totals_y, 470, totals_y + 16), "Subtotal", size=8, color=MUTED, align=2)
                _textbox(page, (475, totals_y, 553, totals_y + 16), _money(document.subtotal), size=8, align=2)
                if document.discount_amount:
                    totals_y += 21
                    _textbox(page, (300, totals_y, 470, totals_y + 16), document.discount_name or "Discount", size=8, color=ACCENT, align=2)
                    _textbox(page, (475, totals_y, 553, totals_y + 16), f"-{_money(document.discount_amount)}", size=8, color=ACCENT, align=2)
                totals_y += 25
                page.draw_line((350, totals_y - 7), (553, totals_y - 7), color=INK, width=1)
                _textbox(page, (350, totals_y, 470, totals_y + 22), "TOTAL", size=10, font="hebo", align=2)
                _textbox(page, (475, totals_y, 553, totals_y + 22), _money(document.total), size=10, font="hebo", align=2)
                if document.amount_paid is not None:
                    totals_y += 24
                    balance = max(document.total - document.amount_paid, 0)
                    _textbox(page, (350, totals_y, 470, totals_y + 16), f"Paid {_money(document.amount_paid)}", size=7.5, color=MUTED, align=2)
                    _textbox(page, (475, totals_y, 553, totals_y + 16), f"Balance {_money(balance)}", size=7.5, color=MUTED, align=2)
                if document.notes:
                    _text(page, (42, 685), "NOTES", size=7, color=ACCENT, font="hebo")
                    _textbox(page, (42, 696, 310, 755), document.notes, size=7.5, color=MUTED)

            page.draw_line((42, 783), (553, 783), color=HAIRLINE, width=.5)
            footer = "  |  ".join(contact_parts)
            if address:
                footer = f"{_safe_text(address)}  |  {footer}" if footer else _safe_text(address)
            _textbox(page, (42, 795, 470, 818), footer or "Thank you for choosing us.", size=6.7, color=MUTED)
            _textbox(page, (480, 795, 553, 818), f"{page_index + 1} / {page_count}", size=6.7, color=MUTED, align=2)
        return output.tobytes(garbage=4, deflate=True)
    finally:
        output.close()


def pdf_to_png(pdf_data: bytes, dpi: int = 150) -> bytes:
    document = pymupdf.open(stream=pdf_data, filetype="pdf")
    images: list[Image.Image] = []
    try:
        for page in document:
            pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
            images.append(Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples))
        width = max(image.width for image in images)
        gap = 24 if len(images) > 1 else 0
        height = sum(image.height for image in images) + gap * (len(images) - 1)
        result = Image.new("RGB", (width, height), "#ddd8ce")
        y = 0
        for image in images:
            result.paste(image, ((width - image.width) // 2, y))
            y += image.height + gap
        stream = BytesIO()
        result.save(stream, format="PNG", optimize=True, dpi=(dpi, dpi))
        result.close()
        return stream.getvalue()
    finally:
        for image in images:
            image.close()
        document.close()
