from __future__ import annotations

from PIL import Image, UnidentifiedImageError

from ..models.document_analysis import DocumentAnalysis
from ..models.enums import DocumentFileType
from ..utils.color_analysis import analyze_image_color
from ..utils.image_processing import image_dpi, open_image, physical_size_mm
from ..utils.page_geometry import classify_orientation, classify_paper_size
from .base import DocumentAnalyzer, InvalidDocumentError, estimate_print_time


class ImageAnalyzer(DocumentAnalyzer):
    file_type = DocumentFileType.image

    def analyze(self, filename: str, data: bytes, mime_type: str) -> DocumentAnalysis:
        try:
            image = open_image(data)
        except (UnidentifiedImageError, OSError) as error:
            raise InvalidDocumentError("The selected image is damaged or unsupported.") from error

        dpi = image_dpi(image)
        width_mm, height_mm = physical_size_mm(image, dpi)
        color = analyze_image_color(image)
        warnings: list[str] = []
        if dpi is None:
            warnings.append("The image has no reliable DPI metadata, so physical paper size is unknown.")
        color_pages = 1 if color.is_colored else 0
        bw_pages = 1 - color_pages
        return DocumentAnalysis(
            filename=filename,
            file_type=self.file_type,
            mime_type=mime_type or Image.MIME.get(image.format, "application/octet-stream"),
            file_size_bytes=len(data),
            page_count=1,
            paper_size=classify_paper_size(width_mm, height_mm),
            orientation=classify_orientation(image.width, image.height),
            width_mm=width_mm,
            height_mm=height_mm,
            dpi=dpi,
            character_count=0,
            word_count=0,
            ocr_required=True,
            image_count=1,
            contains_images=True,
            image_coverage_percent=color.coverage_percent,
            estimated_ink_coverage_percent=color.ink_coverage_percent,
            table_count=0,
            graphic_count=0,
            color_pages=color_pages,
            bw_pages=bw_pages,
            duplex_compatible=False,
            estimated_print_time_seconds=estimate_print_time(color_pages, bw_pages),
            confidence=0.94 if dpi else 0.86,
            warnings=warnings,
        )
