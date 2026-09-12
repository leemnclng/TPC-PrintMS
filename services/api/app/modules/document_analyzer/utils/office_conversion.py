from __future__ import annotations

import logging
from pathlib import Path

import dxpdf

logger = logging.getLogger(__name__)

# Kept in sync with `SUPPORTED_EXTENSIONS` in file_detection.py: every
# supported non-PDF, non-image document type that has a working converter.
# XLSX and PPTX have no reliable pip-only converter today (the one PyPI xlsx
# option is unstyled and breaks on Windows; none exists for pptx), so those
# stay unconverted and printing continues to ask the owner to export to PDF.
CONVERTIBLE_TO_PDF_SUFFIXES = {".docx"}


class DocumentConversionError(ValueError):
    pass


def convert_to_print_ready_pdf(filename: str, data: bytes) -> tuple[str, bytes]:
    """Convert a DOCX source document to PDF bytes for printing/storage.

    Only called for suffixes in `CONVERTIBLE_TO_PDF_SUFFIXES`. Returns the new
    filename (same stem, `.pdf` suffix) and the converted PDF bytes.
    """

    suffix = Path(filename).suffix.lower()
    if suffix not in CONVERTIBLE_TO_PDF_SUFFIXES:
        raise ValueError(f"{suffix} documents cannot be auto-converted to PDF.")
    try:
        pdf_data = dxpdf.convert(data)
    except Exception as error:
        logger.exception("DOCX to PDF conversion failed for %s.", filename)
        raise DocumentConversionError(
            "The Word document could not be converted to PDF for printing. "
            "Export it to PDF and attach that file instead."
        ) from error
    if not pdf_data:
        raise DocumentConversionError(
            "The Word document could not be converted to PDF for printing. "
            "Export it to PDF and attach that file instead."
        )
    pdf_filename = f"{Path(filename).stem}.pdf"
    return pdf_filename, pdf_data
