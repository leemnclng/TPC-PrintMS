from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import (
    DocumentPricingRule,
    PricingCategory,
    PricingCategoryMaterial,
    PrintType,
    Product,
    ProductVariant,
)
from app.services.print_types import ensure_builtin_print_types

from ..models.document_analysis import DocumentAnalysis
from ..models.pricing_result import PricingResult, PricingRuleRead
from ..pricing.engine import PricingEngine


class PricingService:
    def __init__(self) -> None:
        self._engine = PricingEngine()

    def ensure_defaults(self, db: Session) -> list[DocumentPricingRule]:
        """Create rates only for paper explicitly assigned to a category."""
        print_types = ensure_builtin_print_types(db)
        self.ensure_builtin_categories(db)
        assignments = db.query(PricingCategoryMaterial).all()
        existing = {
            (rule.inventory_item_id, rule.print_type, rule.pricing_scope)
            for rule in db.query(DocumentPricingRule).all()
        }
        created_default = False
        for assignment in assignments:
            for print_type in print_types:
                key = (assignment.inventory_item_id, print_type.key, assignment.pricing_category_key)
                if key in existing:
                    continue
                db.add(
                    DocumentPricingRule(
                        inventory_item_id=assignment.inventory_item_id,
                        print_type=print_type.key,
                        pricing_scope=assignment.pricing_category_key,
                        price_per_page=0.0,
                        is_active=True,
                    )
                )
                created_default = True
        if created_default:
            db.commit()
        return (
            db.query(DocumentPricingRule)
            .join(
                PricingCategoryMaterial,
                (PricingCategoryMaterial.pricing_category_key == DocumentPricingRule.pricing_scope)
                & (PricingCategoryMaterial.inventory_item_id == DocumentPricingRule.inventory_item_id),
            )
            .all()
        )

    @staticmethod
    def ensure_builtin_categories(db: Session) -> list[PricingCategory]:
        defaults = (
            ("printing", "Printing", "File-based output sent to a printer.", "printing", 0),
            ("photocopy", "Scan or Photocopy", "Device-side photocopy output. Scan-to-softcopy uses scan tiers.", "photocopy", 1),
        )
        changed = False
        for key, name, description, operation_kind, sort_order in defaults:
            if db.get(PricingCategory, key) is None:
                db.add(PricingCategory(
                    key=key,
                    name=name,
                    description=description,
                    operation_kind=operation_kind,
                    is_builtin=True,
                    is_active=True,
                    sort_order=sort_order,
                ))
                changed = True
        if changed:
            db.commit()
        return db.query(PricingCategory).order_by(PricingCategory.sort_order, PricingCategory.name).all()

    def calculate(
        self,
        analysis: DocumentAnalysis,
        db: Session,
        product: Product | None = None,
        variant: ProductVariant | None = None,
        paper_inventory_item_id: str | None = None,
    ) -> PricingResult:
        rules = self.ensure_defaults(db)
        usable_rules = [
            rule for rule in rules
            if rule.inventory_item.is_active and rule.pricing_scope == "printing"
        ]
        overrides: dict[tuple[str, str], float] | None = None
        definition: PrintType | None = None
        pricing_paper_size = None
        if product is not None:
            definition = db.get(PrintType, product.print_type)
            usable_rules = [
                rule for rule in rules
                if rule.inventory_item.is_active
                and rule.pricing_scope == (product.pricing_category_key or product.operation_kind)
            ]
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
            paper_width_mm=rule.inventory_item.paper_width_mm,
            paper_height_mm=rule.inventory_item.paper_height_mm,
            print_type=rule.print_type,
            pricing_scope=rule.pricing_scope,
            price_per_page=rule.price_per_page,
            is_active=rule.is_active,
        )
