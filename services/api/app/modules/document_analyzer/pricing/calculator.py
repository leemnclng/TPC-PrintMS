from __future__ import annotations

from app.db.models import ProductPrintType

from ..models.document_analysis import DocumentAnalysis
from ..models.enums import PaperSize
from ..models.pricing_result import PricingAdjustment, PricingBreakdownItem, PricingResult


def calculate_price(
    analysis: DocumentAnalysis,
    rates: dict[str, tuple[float, str]] | None,
    base_print_type: str | None = None,
    applies_ink_coverage: bool = False,
    variant_label: str | None = None,
    variant_adjustment: float = 0,
    pricing_paper_size: PaperSize | None = None,
) -> PricingResult:
    warnings: list[str] = []
    if not rates:
        return PricingResult(
            suggested_price=0,
            warnings=["No active pricing rule matches this document. Configure rates in Configuration."],
        )

    breakdown: list[PricingBreakdownItem] = []
    page_groups = (
        ((base_print_type, analysis.page_count),)
        if base_print_type is not None
        else (
            (ProductPrintType.black_and_white.value, analysis.bw_pages),
            (ProductPrintType.colored.value, analysis.color_pages),
        )
    )
    for page_print_type, pages in page_groups:
        if pages == 0:
            continue
        matched = rates.get(page_print_type)
        if matched is None:
            warnings.append(f"No active {page_print_type.replace('_', ' ')} rate is configured.")
            continue
        rate, rate_source = matched
        subtotal = round(pages * rate, 2)
        breakdown.append(
            PricingBreakdownItem(
                paper_size=pricing_paper_size or analysis.paper_size,
                print_type=page_print_type,
                pages=pages,
                rate_per_page=rate,
                subtotal=subtotal,
                rate_source=rate_source,
            )
        )
    base_subtotal = round(sum(item.subtotal for item in breakdown), 2)
    adjustments: list[PricingAdjustment] = []
    if applies_ink_coverage and breakdown:
        ink_percent = analysis.estimated_ink_coverage_percent
        ink_surcharge = round(base_subtotal * ink_percent / 100, 2)
        if ink_surcharge:
            adjustments.append(
                PricingAdjustment(
                    kind="inkCoverage",
                    label="Measured ink load",
                    basis=f"{ink_percent:.1f}% of base print price",
                    amount=ink_surcharge,
                )
            )

    if base_print_type is not None and breakdown and variant_label is not None:
        adjustments.append(
            PricingAdjustment(
                kind="variant",
                label=variant_label,
                basis=f"{analysis.page_count} page(s) × {variant_adjustment:.2f}",
                amount=round(variant_adjustment * analysis.page_count, 2),
            )
        )
    adjustment_total = sum(item.amount for item in adjustments)
    return PricingResult(
        suggested_price=max(0, round(base_subtotal + adjustment_total, 2)),
        base_subtotal=base_subtotal,
        breakdown=breakdown,
        adjustments=adjustments,
        warnings=warnings,
    )
