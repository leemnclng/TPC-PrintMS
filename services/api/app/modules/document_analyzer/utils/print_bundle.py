from __future__ import annotations

from pathlib import Path

import pymupdf


PRINT_BUNDLE_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


def photo_bundle_filename(filenames: list[str]) -> str:
    first = Path(filenames[0]).stem[:40] if filenames else "photo"
    return f"{first}-front-back-{len(filenames)}-sides.pdf"


def combine_print_sources(sources: list[tuple[str, bytes]]) -> bytes:
    """Combine ordered PDF/image sources into one printable PDF.

    Page order is significant: supervised duplex prints odd pages as fronts
    and even pages as backs. Keeping this conversion server-side gives the
    analyzer, retained job file, and printer adapter one identical document.
    """

    combined = pymupdf.open()
    try:
        for filename, data in sources:
            suffix = Path(filename).suffix.lower()
            if suffix not in PRINT_BUNDLE_SUFFIXES:
                raise ValueError("Photo duplex files must be PDF or image files.")
            source = pymupdf.open(stream=data, filetype=suffix.removeprefix("."))
            try:
                if source.page_count != 1:
                    raise ValueError(f"{filename} must contain exactly one printable side.")
                if suffix == ".pdf":
                    combined.insert_pdf(source)
                else:
                    image_pdf = pymupdf.open(stream=source.convert_to_pdf(), filetype="pdf")
                    try:
                        combined.insert_pdf(image_pdf)
                    finally:
                        image_pdf.close()
            finally:
                source.close()
        if combined.page_count < 2:
            raise ValueError("Choose at least two printable sides for Photo Print back-to-back.")
        return combined.tobytes(garbage=4, deflate=True)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("The Photo Print files could not be combined into a front/back document.") from error
    finally:
        combined.close()
