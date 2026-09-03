from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import (
    DocumentPricingRule,
    InventoryItem,
    PrintType,
    PricingCategory,
    PricingCategoryMaterial,
    Product,
    ProductDocumentRate,
    ProductMaterialAssignment,
    ProductVariant,
    Service,
    Variant,
)
from ..db.session import get_db
from ..schemas.products import DeletedProductRead, ProductCreate, ProductRead, ProductUpdate
from ..services.product_deletion import (
    PRODUCT_RECOVERY_WINDOW,
    finalize_expired_product_deletions,
)
from ..services.product_pricing import reference_price_per_page, resolve_scan_price_per_page
from ..services.print_types import ensure_builtin_print_types
from ..modules.document_analyzer.services.pricing_service import PricingService

router = APIRouter(prefix="/products", tags=["products"], dependencies=[Depends(require_token)])


def _to_read(product: Product, db: Session) -> ProductRead:
    overrides = {rate.pricing_rule_id: rate.price_per_page for rate in product.document_rates}
    material_ids = [assignment.inventory_item_id for assignment in product.material_assignments]
    return ProductRead(
        id=product.id,
        service_id=product.service_id,
        service_name=product.service.name,
        service_category=product.service.category,
        print_type_label=product.print_type_definition.label,
        print_color_mode=product.print_type_definition.color_mode,
        print_applies_ink_coverage=product.print_type_definition.applies_ink_coverage,
        name=product.name,
        description=product.description,
        print_type=product.print_type,
        operation_kind=product.operation_kind,
        pricing_category_key=product.pricing_category_key,
        pricing_category_name=product.pricing_category.name if product.pricing_category else None,
        standalone_price_per_page=product.standalone_price_per_page,
        price_per_page=(
            # A scan's rate is page-count tiered, not a single number — this
            # shows the rate for a 1-page scan as a representative reference.
            resolve_scan_price_per_page(product.standalone_price_per_page, 1, db) or 0.0
            if product.operation_kind == "scan"
            else reference_price_per_page(
                product.print_type,
                product.pricing_category_key or product.operation_kind,
                overrides,
                material_ids,
                db,
            )
        ),
        is_active=product.is_active,
        variants=product.variants,
        document_rates=product.document_rates,
        material_assignments=[
            {
                "id": assignment.id,
                "inventory_item_id": assignment.inventory_item_id,
                "inventory_item_name": assignment.inventory_item.name,
                "inventory_item_unit": assignment.inventory_item.unit,
            }
            for assignment in product.material_assignments
        ],
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


def _to_deleted_read(product: Product) -> DeletedProductRead:
    if product.deleted_at is None or product.purge_after is None:
        raise ValueError("Product is not in the recycle bin.")
    return DeletedProductRead(
        id=product.id,
        service_id=product.service_id,
        service_name=product.service.name,
        name=product.name,
        deleted_at=product.deleted_at,
        purge_after=product.purge_after,
    )


@router.get("", response_model=list[ProductRead])
def list_products(service_id: str | None = None, db: Session = Depends(get_db)) -> list[ProductRead]:
    finalize_expired_product_deletions(db)
    query = db.query(Product).filter(Product.deleted_at.is_(None))
    if service_id:
        query = query.filter(Product.service_id == service_id)
    products = query.join(Product.service).order_by(Service.name, Product.name).all()
    return [_to_read(product, db) for product in products]


@router.get("/deleted", response_model=list[DeletedProductRead])
def list_deleted_products(
    service_id: str | None = None, db: Session = Depends(get_db)
) -> list[DeletedProductRead]:
    finalize_expired_product_deletions(db)
    query = db.query(Product).filter(
        Product.deleted_at.isnot(None),
        Product.deletion_finalized_at.is_(None),
    )
    if service_id:
        query = query.filter(Product.service_id == service_id)
    products = query.join(Product.service).order_by(Product.purge_after, Product.name).all()
    return [_to_deleted_read(product) for product in products]


@router.post("", response_model=ProductRead, status_code=201)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> ProductRead:
    data = payload.model_dump()
    variants = data.pop("variants")
    material_assignments = data.pop("material_assignments")
    document_rates = data.pop("document_rates")
    service = db.get(Service, data["service_id"])
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    _validate_operation(service, data["operation_kind"], data["standalone_price_per_page"], variants, material_assignments, document_rates)
    _validate_print_type(data["print_type"], db, require_active=True)
    data["pricing_category_key"] = _validate_pricing_category(
        data["operation_kind"], data["pricing_category_key"], material_assignments, db, require_active=True
    )
    document_rates = _clean_document_rates(
        document_rates, data["print_type"], data["pricing_category_key"], db
    )
    _validate_material_assignments(material_assignments, db, require_active=True)
    _validate_photocopy_materials(data["operation_kind"], material_assignments, db)
    reference_price = resolve_scan_price_per_page(
        data["standalone_price_per_page"], 1, db
    ) if data["operation_kind"] == "scan" else reference_price_per_page(
        data["print_type"],
        data["pricing_category_key"],
        {rate["pricing_rule_id"]: rate["price_per_page"] for rate in document_rates},
        [assignment["inventory_item_id"] for assignment in material_assignments],
        db,
    )
    variants = _clean_variants(variants, reference_price, db, require_active=True)
    product = Product(**data)
    product.variants = [ProductVariant(**v) for v in variants]
    product.material_assignments = [ProductMaterialAssignment(**assignment) for assignment in material_assignments]
    product.document_rates = [ProductDocumentRate(**rate) for rate in document_rates]
    db.add(product)
    db.commit()
    db.refresh(product)
    return _to_read(product, db)


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: str, db: Session = Depends(get_db)) -> ProductRead:
    finalize_expired_product_deletions(db)
    product = db.get(Product, product_id)
    if not product or product.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return _to_read(product, db)


@router.put("/{product_id}", response_model=ProductRead)
def update_product(product_id: str, payload: ProductUpdate, db: Session = Depends(get_db)) -> ProductRead:
    product = db.get(Product, product_id)
    if not product or product.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Product not found.")
    data = payload.model_dump()
    variants = data.pop("variants")
    material_assignments = data.pop("material_assignments")
    document_rates = data.pop("document_rates")
    service = db.get(Service, data["service_id"])
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    if data["pricing_category_key"] is None and data["operation_kind"] == product.operation_kind:
        data["pricing_category_key"] = product.pricing_category_key
    _validate_operation(service, data["operation_kind"], data["standalone_price_per_page"], variants, material_assignments, document_rates)
    _validate_print_type(
        data["print_type"],
        db,
        require_active=data["print_type"] != product.print_type,
    )
    data["pricing_category_key"] = _validate_pricing_category(
        data["operation_kind"],
        data["pricing_category_key"],
        material_assignments,
        db,
        require_active=data["pricing_category_key"] != product.pricing_category_key,
    )
    document_rates = _clean_document_rates(
        document_rates, data["print_type"], data["pricing_category_key"], db
    )
    _validate_material_assignments(material_assignments, db)
    _validate_photocopy_materials(data["operation_kind"], material_assignments, db)
    reference_price = resolve_scan_price_per_page(
        data["standalone_price_per_page"], 1, db
    ) if data["operation_kind"] == "scan" else reference_price_per_page(
        data["print_type"],
        data["pricing_category_key"],
        {rate["pricing_rule_id"]: rate["price_per_page"] for rate in document_rates},
        [assignment["inventory_item_id"] for assignment in material_assignments],
        db,
    )
    existing_variant_ids = {variant.variant_id for variant in product.variants}
    variants = _clean_variants(
        variants,
        reference_price,
        db,
        allowed_inactive_ids=existing_variant_ids,
    )
    for field, value in data.items():
        setattr(product, field, value)
    product.variants.clear()
    product.material_assignments.clear()
    product.document_rates.clear()
    db.flush()
    product.variants.extend(ProductVariant(**variant) for variant in variants)
    product.material_assignments.extend(
        ProductMaterialAssignment(**assignment) for assignment in material_assignments
    )
    product.document_rates.extend(ProductDocumentRate(**rate) for rate in document_rates)
    db.commit()
    db.refresh(product)
    return _to_read(product, db)


@router.delete("/{product_id}", response_model=DeletedProductRead)
def delete_product(product_id: str, db: Session = Depends(get_db)) -> DeletedProductRead:
    finalize_expired_product_deletions(db)
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if product.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Product is already deleted.")
    now = datetime.utcnow()
    product.deleted_was_active = product.is_active
    product.is_active = False
    product.deleted_at = now
    product.purge_after = now + PRODUCT_RECOVERY_WINDOW
    db.commit()
    db.refresh(product)
    return _to_deleted_read(product)


@router.post("/{product_id}/restore", response_model=ProductRead)
def restore_product(product_id: str, db: Session = Depends(get_db)) -> ProductRead:
    product = db.get(Product, product_id)
    if not product or product.deleted_at is None:
        raise HTTPException(status_code=404, detail="Deleted product not found.")
    now = datetime.utcnow()
    if product.deletion_finalized_at is not None or not product.purge_after or product.purge_after <= now:
        finalize_expired_product_deletions(db, now=now)
        raise HTTPException(status_code=410, detail="The five-day restore window has expired.")
    product.is_active = product.deleted_was_active if product.deleted_was_active is not None else True
    product.deleted_at = None
    product.purge_after = None
    product.deletion_finalized_at = None
    product.deleted_was_active = None
    db.commit()
    db.refresh(product)
    return _to_read(product, db)


def _validate_material_assignments(
    assignments: list[dict], db: Session, *, require_active: bool = False
) -> None:
    item_ids = [assignment["inventory_item_id"] for assignment in assignments]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(status_code=400, detail="Each inventory item can be assigned to a product only once.")
    if not item_ids:
        return
    items = db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids)).all()
    found_ids = {item.id for item in items}
    if missing_ids := set(item_ids) - found_ids:
        raise HTTPException(status_code=404, detail=f"Inventory item not found: {next(iter(missing_ids))}.")
    if require_active and (inactive_item := next((item for item in items if not item.is_active), None)):
        raise HTTPException(
            status_code=409,
            detail=f"Inventory item is inactive: {inactive_item.name}.",
        )


def _clean_variants(
    variants: list[dict],
    reference_price: float,
    db: Session,
    *,
    require_active: bool = False,
    allowed_inactive_ids: set[str] | None = None,
) -> list[dict]:
    variant_ids = [variant["variant_id"] for variant in variants]
    if len(variant_ids) != len(set(variant_ids)):
        raise HTTPException(status_code=409, detail="Each variant can be assigned only once per product.")
    if not variant_ids:
        return variants
    global_variants = db.query(Variant).filter(Variant.id.in_(variant_ids)).all()
    variant_by_id = {variant.id: variant for variant in global_variants}
    if missing_ids := set(variant_ids) - set(variant_by_id):
        raise HTTPException(status_code=404, detail=f"Variant not found: {next(iter(missing_ids))}.")
    allowed_inactive_ids = allowed_inactive_ids or set()
    if require_active or any(not variant.is_active and variant.id not in allowed_inactive_ids for variant in global_variants):
        inactive = next((variant for variant in global_variants if not variant.is_active), None)
        if inactive:
            raise HTTPException(status_code=409, detail=f"Variant is inactive: {inactive.label}.")
    for variant in variants:
        global_variant = variant_by_id[variant["variant_id"]]
        if reference_price + variant["price_adjustment"] < 0:
            raise HTTPException(
                status_code=422,
                detail=f"The final unit price for {global_variant.label} cannot be negative.",
            )
    return variants


def _clean_document_rates(
    document_rates: list[dict], print_type: str, pricing_category_key: str | None, db: Session
) -> list[dict]:
    rule_ids = [rate["pricing_rule_id"] for rate in document_rates]
    if len(rule_ids) != len(set(rule_ids)):
        raise HTTPException(status_code=409, detail="Each paper size can be overridden only once.")
    if not rule_ids:
        return document_rates
    rules = db.query(DocumentPricingRule).filter(DocumentPricingRule.id.in_(rule_ids)).all()
    rule_by_id = {rule.id: rule for rule in rules}
    if missing_ids := set(rule_ids) - set(rule_by_id):
        raise HTTPException(status_code=404, detail=f"Pricing rule not found: {next(iter(missing_ids))}.")
    if mismatched := next((rule for rule in rules if rule.print_type != print_type), None):
        raise HTTPException(
            status_code=422,
            detail=f"A document pricing override must match this product's print type ({print_type}).",
        )
    if mismatched_scope := next(
        (rule for rule in rules if rule.pricing_scope != pricing_category_key), None
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "A product pricing override must use the global table for "
                f"{pricing_category_key or 'the selected pricing category'}."
            ),
        )
    return document_rates


def _validate_pricing_category(
    operation_kind: str,
    category_key: str | None,
    material_assignments: list[dict],
    db: Session,
    *,
    require_active: bool,
) -> str | None:
    if operation_kind == "scan":
        if category_key is not None:
            raise HTTPException(status_code=422, detail="Scan products use scan tiers, not a paper pricing category.")
        return None
    PricingService.ensure_builtin_categories(db)
    resolved_key = category_key or operation_kind
    category = db.get(PricingCategory, resolved_key)
    if category is None:
        raise HTTPException(status_code=422, detail="Select a pricing category.")
    if category.operation_kind != operation_kind:
        raise HTTPException(status_code=422, detail="The pricing category does not match this product's workflow.")
    if require_active and not category.is_active:
        raise HTTPException(status_code=409, detail=f"Pricing category is inactive: {category.name}.")
    paper_ids = {
        item_id for (item_id,) in db.query(InventoryItem.id).filter(
            InventoryItem.id.in_([entry["inventory_item_id"] for entry in material_assignments]),
            InventoryItem.paper_size.isnot(None),
        ).all()
    }
    assigned_ids = {
        item_id for (item_id,) in db.query(PricingCategoryMaterial.inventory_item_id).filter(
            PricingCategoryMaterial.pricing_category_key == resolved_key
        ).all()
    }
    if unavailable := paper_ids - assigned_ids:
        item = db.get(InventoryItem, next(iter(unavailable)))
        raise HTTPException(
            status_code=422,
            detail=f"{item.name if item else 'The selected paper'} is not assigned to {category.name}.",
        )
    return resolved_key


def _validate_print_type(print_type: str, db: Session, *, require_active: bool) -> PrintType:
    ensure_builtin_print_types(db)
    definition = db.get(PrintType, print_type)
    if definition is None:
        raise HTTPException(status_code=422, detail="Select a configured print type.")
    if require_active and not definition.is_active:
        raise HTTPException(status_code=409, detail=f"Print type is inactive: {definition.label}.")
    return definition


def _validate_operation(
    service: Service,
    operation_kind: str,
    standalone_price_per_page: float | None,
    variants: list[dict],
    material_assignments: list[dict],
    document_rates: list[dict],
) -> None:
    if service.category == "photocopy" and operation_kind not in {"photocopy", "scan"}:
        raise HTTPException(status_code=422, detail="Choose Photocopy or Scan for this combined service.")
    if service.category == "printing" and operation_kind != "printing":
        raise HTTPException(status_code=422, detail="Printing services can only contain printing products.")
    if operation_kind in {"photocopy", "scan"} and service.category != "photocopy":
        raise HTTPException(status_code=422, detail="Scan and photocopy products require the Scan or Photocopy service category.")
    if operation_kind == "scan":
        # A product-level price is now optional: unset, it falls back to the
        # global scan rate for this product's print type (see
        # resolve_scan_price_per_page), mirroring how a Printing/Photocopy
        # product may leave its own paper rate unset and use the global one.
        if variants or material_assignments or document_rates:
            raise HTTPException(status_code=422, detail="Scan products cannot use print variants, paper, ink, or document pricing rules.")
    elif standalone_price_per_page is not None:
        raise HTTPException(status_code=422, detail="A standalone scan price can only be set on a Scan product.")
    if operation_kind == "printing" and not material_assignments:
        raise HTTPException(status_code=422, detail="Assign at least one material needed to produce this printing product.")


def _validate_photocopy_materials(
    operation_kind: str,
    material_assignments: list[dict],
    db: Session,
) -> None:
    if operation_kind != "photocopy":
        return
    assignment_ids = [entry["inventory_item_id"] for entry in material_assignments]
    has_paper = db.query(InventoryItem).filter(
        InventoryItem.id.in_(assignment_ids),
        InventoryItem.paper_size.isnot(None),
    ).first()
    if not has_paper:
        raise HTTPException(status_code=422, detail="Assign at least one priced paper material to a photocopy product.")
