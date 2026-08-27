from __future__ import annotations

import re
from io import BytesIO
from statistics import mean

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from ..models.document_analysis import DocumentAnalysis, PageMargins
from ..models.enums import DocumentFileType, Orientation
from ..utils.color_analysis import ImageColorMetrics, analyze_image_color
from ..utils.page_geometry import classify_orientation, classify_paper_size, points_to_mm
from .base import DocumentAnalyzer, InvalidDocumentError, estimate_print_time

RGB_OPERATOR = re.compile(rb"([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+(?:rg|RG)\b")
CMYK_OPERATOR = re.compile(rb"([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+(?:k|K)\b")


class PdfAnalyzer(DocumentAnalyzer):
    file_type = DocumentFileType.pdf

    def analyze(self, filename: str, data: bytes, mime_type: str) -> DocumentAnalysis:
        try:
            reader = PdfReader(BytesIO(data), strict=False)
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception as error:
                    raise InvalidDocumentError("Password-protected PDFs cannot be analyzed.") from error
            pages = list(reader.pages)
        except (PdfReadError, OSError, ValueError) as error:
            if isinstance(error, InvalidDocumentError):
                raise
            raise InvalidDocumentError("The selected PDF is damaged or unsupported.") from error
        if not pages:
            raise InvalidDocumentError("The selected PDF has no printable pages.")

        texts: list[str] = []
        page_sizes: list[tuple[float, float]] = []
        orientations: list[Orientation] = []
        color_pages = 0
        image_count = 0
        graphic_count = 0
        image_metrics: list[ImageColorMetrics] = []

        for page in pages:
            try:
                texts.append(page.extract_text() or "")
            except Exception:
                texts.append("")
            width_mm = points_to_mm(float(page.mediabox.width))
            height_mm = points_to_mm(float(page.mediabox.height))
            page_sizes.append((width_mm, height_mm))
            orientations.append(classify_orientation(width_mm, height_mm))
            page_is_colored = self._content_uses_color(page)

            try:
                for image_file in page.images:
                    image_count += 1
                    metrics = analyze_image_color(image_file.image)
                    image_metrics.append(metrics)
                    page_is_colored = page_is_colored or metrics.is_colored
            except Exception:
                pass

            try:
                resources = page.get("/Resources") or {}
                xobjects = resources.get("/XObject") or {}
                if hasattr(xobjects, "get_object"):
                    xobjects = xobjects.get_object()
                graphic_count += sum(
                    1
                    for item in xobjects.values()
                    if getattr(item.get_object(), "get", lambda *_: None)("/Subtype") == "/Form"
                )
            except Exception:
                pass
            color_pages += int(page_is_colored)

        text = "\n".join(texts).strip()
        first_width, first_height = page_sizes[0]
        same_size = all(abs(width - first_width) <= 2 and abs(height - first_height) <= 2 for width, height in page_sizes)
        orientation = orientations[0] if len(set(orientations)) == 1 else Orientation.mixed
        warnings = ["PDF table and vector-coverage detection is conservative."]
        if not same_size:
            warnings.append("The PDF contains mixed page sizes; the first page sets the pricing paper size.")
        if image_count and not text:
            warnings.append("No embedded text was found; OCR may be needed for scanned pages.")

        coverage = round(mean(metric.coverage_percent for metric in image_metrics), 1) if image_metrics else 0.0
        ink = round(mean(metric.ink_coverage_percent for metric in image_metrics), 1) if image_metrics else 0.0
        bw_pages = len(pages) - color_pages
        return DocumentAnalysis(
            filename=filename,
            file_type=self.file_type,
            mime_type=mime_type or "application/pdf",
            file_size_bytes=len(data),
            page_count=len(pages),
            paper_size=classify_paper_size(first_width, first_height),
            orientation=orientation,
            width_mm=first_width,
            height_mm=first_height,
            dpi=None,
            character_count=len(text),
            word_count=len(text.split()),
            ocr_required=not bool(text) and image_count > 0,
            image_count=image_count,
            contains_images=image_count > 0,
            image_coverage_percent=coverage,
            estimated_ink_coverage_percent=ink,
            table_count=0,
            graphic_count=graphic_count,
            margins=self._crop_margins(pages[0]),
            color_pages=color_pages,
            bw_pages=bw_pages,
            duplex_compatible=len(pages) > 1 and same_size,
            estimated_print_time_seconds=estimate_print_time(color_pages, bw_pages),
            confidence=0.9 if text else 0.8,
            warnings=warnings,
        )

    @staticmethod
    def _content_uses_color(page) -> bool:
        try:
            content = page.get_contents()
            raw = content.get_data() if content else b""
        except Exception:
            return False
        for match in RGB_OPERATOR.finditer(raw):
            values = [float(value) for value in match.groups()]
            if max(values) - min(values) > 0.02:
                return True
        for match in CMYK_OPERATOR.finditer(raw):
            cyan, magenta, yellow, _black = (float(value) for value in match.groups())
            if max(cyan, magenta, yellow) > 0.02:
                return True
        return False

    @staticmethod
    def _crop_margins(page) -> PageMargins | None:
        try:
            media = page.mediabox
            crop = page.cropbox
            return PageMargins(
                top_mm=max(0, points_to_mm(float(media.top) - float(crop.top))),
                right_mm=max(0, points_to_mm(float(media.right) - float(crop.right))),
                bottom_mm=max(0, points_to_mm(float(crop.bottom) - float(media.bottom))),
                left_mm=max(0, points_to_mm(float(crop.left) - float(media.left))),
            )
        except Exception:
            return None
