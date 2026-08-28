from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import DocumentPricingRule, InventoryItem, PrintType, Product, ProductVariant
from app.services.print_types import ensure_builtin_print_types

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
        print_types = ensure_builtin_print_types(db)
        paper_items = (
            db.query(InventoryItem)
            .filter(InventoryItem.paper_size.isnot(None), InventoryItem.is_active.is_(True))
            .all()
        )
        existing = {(rule.inventory_item_id, rule.print_type) for rule in db.query(DocumentPricingRule).all()}
        created_default = False
        for item in paper_items:
            for print_type in print_types:
                if (item.id, print_type.key) in existing:
                    continue
                db.add(
                    DocumentPricingRule(
                        inventory_item_id=item.id,
                        print_type=print_type.key,
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

    def calculate(
        self,
        analysis: DocumentAnalysis,
        db: Session,
        product: Product | None = None,
        variant: ProductVariant | None = None,
        paper_inventory_item_id: str | None = None,
    ) -> PricingResult:
        rules = self.ensure_defaults(db)
        usable_rules = [rule for rule in rules if rule.inventory_item.is_active]
        overrides: dict[tuple[str, str], float] | None = None
        definition: PrintType | None = None
        pricing_paper_size = None
        if product is not None:
            definition = db.get(PrintType, product.print_type)
            assigned_material_ids = {assignment.inventory_item_id for assignment in product.material_assignments}
            usable_rules = [
                rule
                for rule in usable_rules
                if rule.inventory_item_id in assigned_material_ids
            ]
            if paper_inventory_item_id is not None:
                usable_rules = [
                    rule for rule in usable_rules if rule.inventory_item_id == paper_inventory_item_id
                ]
                selected_assignment = next(
                    (
                        assignment
                        for assignment in product.material_assignments
                        if assignment.inventory_item_id == paper_inventory_item_id
                    ),
                    None,
                )
                if selected_assignment is not None:
                    pricing_paper_size = selected_assignment.inventory_item.paper_size
            usable_rule_ids = {rule.id for rule in usable_rules if rule.is_active}
            overrides = {
                (rate.paper_size.value, rate.print_type): rate.price_per_page
                for rate in product.document_rates
                if rate.pricing_rule_id in usable_rule_ids and rate.print_type == product.print_type
            }
        return self._engine.calculate(
            analysis,
            usable_rules,
            overrides,
            product.print_type if product is not None else None,
            definition.applies_ink_coverage if definition is not None else False,
            variant.label if variant is not None else None,
            variant.price_adjustment if variant is not None else 0,
            pricing_paper_size,
        )

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
