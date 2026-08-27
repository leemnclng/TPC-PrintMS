from __future__ import annotations

from abc import ABC, abstractmethod

from ..models.document_analysis import DocumentAnalysis
from ..models.enums import DocumentFileType


class InvalidDocumentError(ValueError):
    pass


class DocumentAnalyzer(ABC):
    file_type: DocumentFileType

    @abstractmethod
    def analyze(self, filename: str, data: bytes, mime_type: str) -> DocumentAnalysis:
        raise NotImplementedError


def estimate_print_time(color_pages: int, bw_pages: int) -> int:
    return max(1, color_pages * 4 + bw_pages * 2)
