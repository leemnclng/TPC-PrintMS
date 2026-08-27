from __future__ import annotations

from pathlib import Path
from zipfile import BadZipFile, ZipFile

from ..models.enums import DocumentFileType

MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 10_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1_000

IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf", ".docx", ".xlsx", ".pptx"}

MIME_BY_TYPE = {
    DocumentFileType.pdf: "application/pdf",
    DocumentFileType.image: "image/*",
    DocumentFileType.docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    DocumentFileType.xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    DocumentFileType.pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


class UnsupportedFileTypeError(ValueError):
    pass


class UnsafeArchiveError(ValueError):
    pass


def detect_file_type(filename: str, data: bytes) -> DocumentFileType:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFileTypeError(
            "Supported files are PDF, PNG, JPEG, TIFF, BMP, WebP, DOCX, XLSX, and PPTX."
        )
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise UnsupportedFileTypeError("The selected file does not contain a valid PDF signature.")
        return DocumentFileType.pdf
    if suffix in IMAGE_EXTENSIONS:
        return DocumentFileType.image

    _validate_office_archive(data)
    with ZipFile(_bytes_io(data)) as archive:
        names = set(archive.namelist())
    if suffix == ".docx" and "word/document.xml" in names:
        return DocumentFileType.docx
    if suffix == ".xlsx" and "xl/workbook.xml" in names:
        return DocumentFileType.xlsx
    if suffix == ".pptx" and "ppt/presentation.xml" in names:
        return DocumentFileType.pptx
    raise UnsupportedFileTypeError("The file extension does not match its document contents.")


def validate_office_archive(data: bytes) -> None:
    _validate_office_archive(data)


def _validate_office_archive(data: bytes) -> None:
    try:
        with ZipFile(_bytes_io(data)) as archive:
            members = archive.infolist()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                raise UnsafeArchiveError("The document contains too many embedded files to analyze safely.")
            uncompressed = sum(member.file_size for member in members)
            compressed = sum(max(member.compress_size, 1) for member in members)
            if uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                raise UnsafeArchiveError("The expanded document is too large to analyze safely.")
            if uncompressed / max(compressed, 1) > MAX_COMPRESSION_RATIO:
                raise UnsafeArchiveError("The document compression ratio is unsafe to analyze.")
    except BadZipFile as error:
        raise UnsupportedFileTypeError("The selected Office document is damaged or invalid.") from error


def _bytes_io(data: bytes):
    from io import BytesIO

    return BytesIO(data)
