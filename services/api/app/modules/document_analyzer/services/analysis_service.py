from __future__ import annotations

from ..analyzers import DocxAnalyzer, ExcelAnalyzer, ImageAnalyzer, PdfAnalyzer, PptxAnalyzer
from ..analyzers.base import DocumentAnalyzer, InvalidDocumentError
from ..models.document_analysis import DocumentAnalysis
from ..models.enums import DocumentFileType
from ..utils.file_detection import detect_file_type


class AnalysisService:
    def __init__(self) -> None:
        analyzers: list[DocumentAnalyzer] = [
            PdfAnalyzer(),
            ImageAnalyzer(),
            DocxAnalyzer(),
            ExcelAnalyzer(),
            PptxAnalyzer(),
        ]
        self._analyzers = {analyzer.file_type: analyzer for analyzer in analyzers}

    def analyze(self, filename: str, data: bytes, mime_type: str = "") -> DocumentAnalysis:
        file_type = detect_file_type(filename, data)
        try:
            return self._analyzers[file_type].analyze(filename, data, mime_type)
        except InvalidDocumentError:
            raise
        except Exception as error:
            raise InvalidDocumentError(
                f"{DocumentFileType(file_type).value.upper()} analysis failed because the document is damaged or unsupported."
            ) from error
