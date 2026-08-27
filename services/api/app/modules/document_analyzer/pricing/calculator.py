from __future__ import annotations

from app.db.models import ProductPrintType

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingBreakdownItem, PricingResult


def calculate_price(
    analysis: DocumentAnalysis,
    rates: dict[ProductPrintType, tuple[float, str]] | None,
) -> PricingResult:
    warnings: list[str] = []
    if not rates:
        return PricingResult(
            suggested_price=0,
            warnings=["No active pricing rule matches this document. Configure rates in Configuration."],
        )

    breakdown: list[PricingBreakdownItem] = []
    for print_type, pages in (
        (ProductPrintType.black_and_white, analysis.bw_pages),
        (ProductPrintType.colored, analysis.color_pages),
    ):
        if pages == 0:
            continue
        matched = rates.get(print_type)
        if matched is None:
            warnings.append(f"No active {print_type.value.replace('_', ' ')} rate is configured.")
            continue
        rate, rate_source = matched
        subtotal = round(pages * rate, 2)
        breakdown.append(
            PricingBreakdownItem(
                paper_size=analysis.paper_size,
                print_type=print_type,
                pages=pages,
                rate_per_page=rate,
                subtotal=subtotal,
                rate_source=rate_source,
            )
        )
    return PricingResult(
        suggested_price=round(sum(item.subtotal for item in breakdown), 2),
        breakdown=breakdown,
        warnings=warnings,
    )
