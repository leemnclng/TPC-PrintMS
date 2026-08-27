from __future__ import annotations

from collections.abc import Iterable

from app.db.models import DocumentPricingRule, ProductPrintType

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingResult
from .calculator import calculate_price


class PricingEngine:
    def calculate(
        self,
        analysis: DocumentAnalysis,
        rules: Iterable[DocumentPricingRule],
        product_overrides: dict[tuple[str, ProductPrintType], float] | None = None,
    ) -> PricingResult:
        active = [rule for rule in rules if rule.is_active]
        exact = {
            rule.print_type: rule.price_per_page
            for rule in active
            if rule.paper_size.value == analysis.paper_size.value
        }
        product_overrides = product_overrides or {}
        rates: dict[ProductPrintType, tuple[float, str]] = {}
        for print_type in ProductPrintType:
            override_key = (analysis.paper_size.value, print_type)
            if override_key in product_overrides:
                rates[print_type] = (product_overrides[override_key], "product")
            elif print_type in exact:
                rates[print_type] = (exact[print_type], "paperSize")
        return calculate_price(analysis, rates)
