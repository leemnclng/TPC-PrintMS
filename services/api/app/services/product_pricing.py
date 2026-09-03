"""Resolve product prices from the paper materials linked to the product."""

from __future__ import annotations

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..db.models import DocumentPricingRule, InventoryItem, PricingCategoryMaterial, ScanPricingTier


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
        .join(
            PricingCategoryMaterial,
            (PricingCategoryMaterial.pricing_category_key == DocumentPricingRule.pricing_scope)
            & (PricingCategoryMaterial.inventory_item_id == DocumentPricingRule.inventory_item_id),
        )
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
        .join(
            PricingCategoryMaterial,
            (PricingCategoryMaterial.pricing_category_key == DocumentPricingRule.pricing_scope)
            & (PricingCategoryMaterial.inventory_item_id == DocumentPricingRule.inventory_item_id),
        )
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


def has_scan_pricing_configured(override: float | None, db: Session) -> bool:
    """Whether a Scan product could ever be priced: its own `override`, or at
    least one active global page-count tier exists somewhere. Used before the
    real page count is known (e.g. at job creation) — the exact rate is only
    resolvable once scanning reveals how many pages there are."""
    if override is not None:
        return True
    return db.query(ScanPricingTier).filter(ScanPricingTier.is_active.is_(True)).first() is not None


def resolve_scan_price_per_page(override: float | None, pages: int, db: Session) -> float | None:
    """A Scan product's effective per-page rate for a scan of `pages` pages:
    its own `override` (the product's `standalone_price_per_page`) when set,
    otherwise the active global tier whose page-count range covers `pages`.
    `None` if neither exists."""
    if override is not None:
        return override
    tier = (
        db.query(ScanPricingTier)
        .filter(
            ScanPricingTier.is_active.is_(True),
            ScanPricingTier.min_pages <= pages,
            or_(ScanPricingTier.max_pages.is_(None), ScanPricingTier.max_pages >= pages),
        )
        .first()
    )
    return tier.price_per_page if tier else None


def scan_tier_ranges_overlap(
    min_pages: int, max_pages: int | None, db: Session, *, exclude_id: str | None = None
) -> bool:
    """Whether [min_pages, max_pages] overlaps any other active tier's range.
    `max_pages` of None means open-ended ("and up"). Two ranges overlap when
    each one's start falls at or before the other's end."""
    query = db.query(ScanPricingTier).filter(ScanPricingTier.is_active.is_(True))
    if exclude_id:
        query = query.filter(ScanPricingTier.id != exclude_id)
    conditions = [or_(ScanPricingTier.max_pages.is_(None), ScanPricingTier.max_pages >= min_pages)]
    if max_pages is not None:
        conditions.append(ScanPricingTier.min_pages <= max_pages)
    return query.filter(and_(*conditions)).first() is not None
