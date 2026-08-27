from __future__ import annotations

from app.db.models import ProductPrintType

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingAdjustment, PricingBreakdownItem, PricingResult


def calculate_price(
    analysis: DocumentAnalysis,
    rates: dict[ProductPrintType, tuple[float, str]] | None,
    base_print_type: ProductPrintType | None = None,
    variant_label: str | None = None,
    variant_adjustment: float = 0,
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
            (ProductPrintType.black_and_white, analysis.bw_pages),
            (ProductPrintType.colored, analysis.color_pages),
        )
    )
    for page_print_type, pages in page_groups:
        if pages == 0:
            continue
        matched = rates.get(page_print_type)
        if matched is None:
            warnings.append(f"No active {page_print_type.value.replace('_', ' ')} rate is configured.")
            continue
        rate, rate_source = matched
        subtotal = round(pages * rate, 2)
        breakdown.append(
            PricingBreakdownItem(
                paper_size=analysis.paper_size,
                print_type=page_print_type,
                pages=pages,
                rate_per_page=rate,
                subtotal=subtotal,
                rate_source=rate_source,
            )
        )
    base_subtotal = round(sum(item.subtotal for item in breakdown), 2)
    adjustments: list[PricingAdjustment] = []
    if base_print_type is not None and breakdown:
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

        color_percent = analysis.estimated_color_coverage_percent
        if base_print_type == ProductPrintType.black_and_white and color_percent > 0:
            color_rate = rates.get(ProductPrintType.colored)
            if color_rate is None:
                warnings.append("Color was detected, but this paper has no active colored rate for a surcharge reference.")
            else:
                base_rate = breakdown[0].rate_per_page
                color_premium = max(0.0, color_rate[0] - base_rate)
                color_surcharge = round(color_premium * analysis.page_count * color_percent / 100, 2)
                if color_surcharge:
                    adjustments.append(
                        PricingAdjustment(
                            kind="colorCoverage",
                            label="Color coverage premium",
                            basis=f"{color_percent:.1f}% coverage × {analysis.page_count} page(s)",
                            amount=color_surcharge,
                        )
                    )
                else:
                    warnings.append("Color was detected, but the configured colored rate does not add a premium.")

        if variant_label is not None:
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
