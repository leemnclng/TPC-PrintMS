from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import DocumentPricingRule, InventoryItem, Product, ProductPrintType

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingResult, PricingRuleRead
from ..pricing.engine import PricingEngine


class PricingService:
    def __init__(self) -> None:
        self._engine = PricingEngine()

    def ensure_defaults(self, db: Session) -> list[DocumentPricingRule]:
        """Every active, paper-tagged inventory item gets a rule per print
        type (starting at ₱0, for the owner to configure). Unlike the old
        fixed paper-size list, this is fully driven by what the owner has
        actually tagged as paper stock in Inventory — see decisions.md "Tie
        Document Pricing to Real Paper Stock"."""
        paper_items = (
            db.query(InventoryItem)
            .filter(InventoryItem.paper_size.isnot(None), InventoryItem.is_active.is_(True))
            .all()
        )
        existing = {(rule.inventory_item_id, rule.print_type) for rule in db.query(DocumentPricingRule).all()}
        created_default = False
        for item in paper_items:
            for print_type in ProductPrintType:
                if (item.id, print_type) in existing:
                    continue
                db.add(
                    DocumentPricingRule(
                        inventory_item_id=item.id,
                        print_type=print_type,
                        price_per_page=0.0,
                        is_active=True,
                    )
                )
                created_default = True
        if created_default:
            db.commit()
        # Every rule is returned (even ones whose item has since gone
        # inactive) so the owner keeps visibility into what they set;
        # `calculate` filters to active items separately for actual pricing.
        return db.query(DocumentPricingRule).all()

    def calculate(self, analysis: DocumentAnalysis, db: Session, product: Product | None = None) -> PricingResult:
        rules = self.ensure_defaults(db)
        usable_rules = [rule for rule in rules if rule.inventory_item.is_active]
        overrides: dict[tuple[str, ProductPrintType], float] | None = None
        if product is not None:
            overrides = {
                (rate.paper_size.value, rate.print_type): rate.price_per_page for rate in product.document_rates
            }
        return self._engine.calculate(analysis, usable_rules, overrides)

    @staticmethod
    def to_read(rule: DocumentPricingRule) -> PricingRuleRead:
        return PricingRuleRead(
            id=rule.id,
            inventory_item_id=rule.inventory_item_id,
            inventory_item_name=rule.inventory_item.name,
            paper_size=rule.paper_size,
            print_type=rule.print_type,
            price_per_page=rule.price_per_page,
            is_active=rule.is_active,
        )
