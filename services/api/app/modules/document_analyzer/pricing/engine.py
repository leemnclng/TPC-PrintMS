from __future__ import annotations

from collections.abc import Iterable

from app.db.models import DocumentPricingRule, InventoryPaperSize

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingResult
from .calculator import calculate_price


class PricingEngine:
    def calculate(
        self,
        analysis: DocumentAnalysis,
        rules: Iterable[DocumentPricingRule],
        product_overrides: dict[tuple[str, str], float] | None = None,
        print_type: str | None = None,
        applies_ink_coverage: bool = False,
        variant_label: str | None = None,
        variant_adjustment: float = 0,
        paper_size: InventoryPaperSize | None = None,
    ) -> PricingResult:
        active = [rule for rule in rules if rule.is_active]
        pricing_paper_size = paper_size.value if paper_size is not None else analysis.paper_size.value
        exact = {
            rule.print_type: rule.price_per_page
            for rule in active
            if rule.paper_size.value == pricing_paper_size
        }
        product_overrides = product_overrides or {}
        rates: dict[str, tuple[float, str]] = {}
        configured_print_types = set(exact) | {
            rate_print_type
            for paper_size, rate_print_type in product_overrides
            if paper_size == pricing_paper_size
        }
        for rate_print_type in configured_print_types:
            override_key = (pricing_paper_size, rate_print_type)
            if override_key in product_overrides:
                rates[rate_print_type] = (product_overrides[override_key], "product")
            elif rate_print_type in exact:
                rates[rate_print_type] = (exact[rate_print_type], "paperSize")
        return calculate_price(
            analysis,
            rates,
            print_type,
            applies_ink_coverage,
            variant_label,
            variant_adjustment,
            paper_size,
        )
