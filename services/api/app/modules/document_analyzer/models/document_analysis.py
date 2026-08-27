from __future__ import annotations

from pydantic import Field

from app.schemas.common import CamelModel

from .enums import DocumentFileType, Orientation, PaperSize
from .pricing_result import PricingContext, PricingResult


class PageMargins(CamelModel):
    top_mm: float
    right_mm: float
    bottom_mm: float
    left_mm: float


class DocumentAnalysis(CamelModel):
    filename: str
    file_type: DocumentFileType
    mime_type: str
    file_size_bytes: int
    page_count: int = Field(ge=1)
    paper_size: PaperSize
    orientation: Orientation
    width_mm: float | None = None
    height_mm: float | None = None
    dpi: float | None = None
    character_count: int = Field(ge=0)
    word_count: int = Field(ge=0)
    ocr_required: bool
    image_count: int = Field(ge=0)
    contains_images: bool
    image_coverage_percent: float = Field(ge=0, le=100)
    estimated_ink_coverage_percent: float = Field(ge=0, le=100)
    table_count: int = Field(ge=0)
    graphic_count: int = Field(ge=0)
    margins: PageMargins | None = None
    color_pages: int = Field(ge=0)
    bw_pages: int = Field(ge=0)
    duplex_compatible: bool
    estimated_print_time_seconds: int = Field(ge=1)
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)


class AnalysisResponse(CamelModel):
    analysis: DocumentAnalysis
    pricing: PricingResult
    pricing_context: PricingContext | None = None
