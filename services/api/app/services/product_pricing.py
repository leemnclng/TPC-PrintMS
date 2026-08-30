"""Resolve product prices from the paper materials linked to the product."""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..db.models import DocumentPricingRule, InventoryItem


def reference_price_per_page(
    print_type: str,
    pricing_scope: str,
    document_rate_overrides: dict[str, float],
    inventory_item_ids: list[str],
    db: Session,
    *,
    require_override: bool = False,
) -> float:
    """`document_rate_overrides` maps pricing-rule id -> the product's own
    override price, e.g. `{rate.pricing_rule_id: rate.price_per_page for rate
    in product.document_rates}` (or the equivalent from a not-yet-saved
    payload). The reference is the lowest usable rate among the product's
    assigned paper materials within `pricing_scope`, so catalog surfaces can
    honestly show a starting price. Resolution per material is product
    override -> matching active global rate; a product without a priced paper
    material resolves to 0."""
    if not inventory_item_ids:
        return 0.0
    rules = (
        db.query(DocumentPricingRule)
        .join(InventoryItem)
        .filter(
            InventoryItem.id.in_(inventory_item_ids),
            InventoryItem.paper_size.isnot(None),
            InventoryItem.is_active.is_(True),
            DocumentPricingRule.print_type == print_type,
            DocumentPricingRule.pricing_scope == pricing_scope,
            DocumentPricingRule.is_active.is_(True),
        )
        .all()
    )
    if not rules:
        return 0.0
    prices = [
        document_rate_overrides[rule.id]
        if require_override
        else document_rate_overrides.get(rule.id, rule.price_per_page)
        for rule in rules
        if not require_override or rule.id in document_rate_overrides
    ]
    return min(prices) if prices else 0.0


def price_per_page_for_material(
    print_type: str,
    pricing_scope: str,
    document_rate_overrides: dict[str, float],
    inventory_item_id: str,
    db: Session,
    *,
    require_override: bool = False,
) -> float | None:
    """Return the exact active rate for one selected paper material."""
    rule = (
        db.query(DocumentPricingRule)
        .join(InventoryItem)
        .filter(
            InventoryItem.id == inventory_item_id,
            InventoryItem.paper_size.isnot(None),
            InventoryItem.is_active.is_(True),
            DocumentPricingRule.print_type == print_type,
            DocumentPricingRule.pricing_scope == pricing_scope,
            DocumentPricingRule.is_active.is_(True),
        )
        .first()
    )
    if rule is None:
        return None
    if require_override and rule.id not in document_rate_overrides:
        return None
    return document_rate_overrides.get(rule.id, rule.price_per_page)
