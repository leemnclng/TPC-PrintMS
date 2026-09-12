from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.security import require_token
from app.db.models import (
    DocumentPricingRule,
    GlobalPricingVariable,
    PricingDiscount,
    PricingDiscountProduct,
    InventoryItem,
    PricingCategory,
    PricingCategoryMaterial,
    Product,
    ProductMaterialAssignment,
    ProductVariant,
    ScanPricingTier,
)
from app.db.session import get_db
from app.services.product_pricing import scan_tier_ranges_overlap

from .analyzers.base import InvalidDocumentError
from .models.document_analysis import AnalysisResponse
from .models.pricing_result import (
    PricingContext,
    PricingCategoryCreate,
    PricingCategoryRead,
    PricingCategoryUpdate,
    PricingRuleRead,
    PricingRulesUpdate,
    GlobalPricingVariableCreate,
    GlobalPricingVariableRead,
    GlobalPricingVariableUpdate,
    PricingDiscountCreate,
    PricingDiscountRead,
    PricingDiscountUpdate,
    ScanPricingTierCreate,
    ScanPricingTierRead,
    ScanPricingTierUpdate,
)
from .services.analysis_service import AnalysisService
from .services.pricing_service import PricingService
from .utils.file_detection import (
    MAX_FILE_SIZE_BYTES,
    UnsafeArchiveError,
    UnsupportedFileTypeError,
)
from .utils.print_bundle import combine_print_sources, photo_bundle_filename

router = APIRouter(
    prefix="/document-analyzer",
    tags=["document-analyzer"],
    dependencies=[Depends(require_token)],
)
analysis_service = AnalysisService()
pricing_service = PricingService()


@router.post("/analyze", response_model=AnalysisResponse, response_model_exclude_none=True)
async def analyze_document(
    file: UploadFile = File(...),
    product_id: str | None = Form(None),
    variant_id: str | None = Form(None),
    paper_inventory_item_id: str | None = Form(None),
    db: Session = Depends(get_db),
) -> AnalysisResponse:
    product: Product | None = None
    variant: ProductVariant | None = None
    if product_id:
        product = db.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        if product.service.category != "printing" or product.operation_kind != "printing":
            raise HTTPException(
                status_code=422,
                detail="Document analysis is available only for services in the Printing category.",
            )
    if variant_id:
        if product is None:
            raise HTTPException(status_code=422, detail="Select a product before selecting a variant.")
        variant = (
            db.query(ProductVariant)
            .filter(ProductVariant.product_id == product.id, ProductVariant.variant_id == variant_id)
            .first()
        )
        if variant is None:
            raise HTTPException(status_code=404, detail="Variant is not assigned to the selected product.")
    if paper_inventory_item_id:
        if product is None:
            raise HTTPException(status_code=422, detail="Select a product before selecting print paper.")
        paper_assignment = (
            db.query(ProductMaterialAssignment)
            .filter(
                ProductMaterialAssignment.product_id == product.id,
                ProductMaterialAssignment.inventory_item_id == paper_inventory_item_id,
            )
            .one_or_none()
        )
        if (
            paper_assignment is None
            or not paper_assignment.inventory_item.is_active
            or paper_assignment.inventory_item.paper_size is None
        ):
            raise HTTPException(status_code=422, detail="Select an active paper configured for this product.")

    filename = Path(file.filename or "document").name
    content_type = file.content_type or ""
    data = await file.read(MAX_FILE_SIZE_BYTES + 1)
    await file.close()
    if not data:
        raise HTTPException(status_code=422, detail="Select a non-empty document to analyze.")
    if len(data) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Documents must be 25 MB or smaller.")
    try:
        analysis = await run_in_threadpool(
            analysis_service.analyze,
            filename,
            data,
            content_type,
        )
    except UnsupportedFileTypeError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except (InvalidDocumentError, UnsafeArchiveError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    pricing = pricing_service.calculate(
        analysis,
        db,
        product,
        variant,
        paper_inventory_item_id,
    )
    if paper_inventory_item_id and not pricing.breakdown:
        raise HTTPException(
            status_code=422,
            detail="The selected paper has no active price for this product's print type.",
        )
    return AnalysisResponse(
        analysis=analysis,
        pricing=pricing,
        pricing_context=(
            PricingContext(
                product_id=product.id,
                product_name=product.name,
                print_type_label=product.print_type_definition.label,
                applies_ink_coverage=product.print_type_definition.applies_ink_coverage,
                variant_id=variant.variant_id if variant else None,
                variant_name=variant.label if variant else None,
            )
            if product
            else None
        ),
    )


@router.post("/analyze-photo-duplex", response_model=AnalysisResponse, response_model_exclude_none=True)
async def analyze_photo_duplex(
    files: list[UploadFile] = File(...),
    product_id: str = Form(...),
    variant_id: str = Form(...),
    paper_inventory_item_id: str = Form(...),
    db: Session = Depends(get_db),
) -> AnalysisResponse:
    """Analyze ordered Photo Print files as one supervised duplex document."""

    product = db.get(Product, product_id)
    if not product or product.operation_kind != "printing" or product.print_type != "photo_print":
        raise HTTPException(status_code=422, detail="Select a Photo Print product for multiple back-to-back files.")
    variant = (
        db.query(ProductVariant)
        .filter(ProductVariant.product_id == product.id, ProductVariant.variant_id == variant_id)
        .first()
    )
    if variant is None or not variant.requires_manual_duplex:
        raise HTTPException(status_code=422, detail="Select a configured back-to-back variant for these Photo Print files.")
    paper_assignment = (
        db.query(ProductMaterialAssignment)
        .filter(
            ProductMaterialAssignment.product_id == product.id,
            ProductMaterialAssignment.inventory_item_id == paper_inventory_item_id,
        )
        .one_or_none()
    )
    if (
        paper_assignment is None
        or not paper_assignment.inventory_item.is_active
        or paper_assignment.inventory_item.paper_size is None
    ):
        raise HTTPException(status_code=422, detail="Select an active paper configured for this Photo Print product.")
    if len(files) < 2:
        raise HTTPException(status_code=422, detail="Choose at least two files, ordered front then back.")
    if len(files) > 100:
        raise HTTPException(status_code=422, detail="A Photo Print duplex set can contain at most 100 files.")

    sources: list[tuple[str, bytes]] = []
    total_size = 0
    for file in files:
        filename = Path(file.filename or "photo-side").name
        remaining = MAX_FILE_SIZE_BYTES - total_size
        data = await file.read(remaining + 1)
        await file.close()
        if not data:
            raise HTTPException(status_code=422, detail=f"Choose a non-empty file for {filename}.")
        total_size += len(data)
        if total_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="The combined Photo Print files must be 25 MB or smaller.")
        sources.append((filename, data))
    try:
        combined_data = await run_in_threadpool(combine_print_sources, sources)
        if len(combined_data) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="The combined Photo Print PDF must be 25 MB or smaller.")
        analysis = await run_in_threadpool(
            analysis_service.analyze,
            photo_bundle_filename([filename for filename, _data in sources]),
            combined_data,
            "application/pdf",
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except UnsupportedFileTypeError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except (InvalidDocumentError, UnsafeArchiveError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    pricing = pricing_service.calculate(
        analysis,
        db,
        product,
        variant,
        paper_inventory_item_id,
    )
    if not pricing.breakdown:
        raise HTTPException(status_code=422, detail="The selected paper has no active Photo Print price.")
    return AnalysisResponse(
        analysis=analysis,
        pricing=pricing,
        pricing_context=PricingContext(
            product_id=product.id,
            product_name=product.name,
            print_type_label=product.print_type_definition.label,
            applies_ink_coverage=product.print_type_definition.applies_ink_coverage,
            variant_id=variant.variant_id,
            variant_name=variant.label,
        ),
    )


@router.get("/pricing-rules", response_model=list[PricingRuleRead])
def list_pricing_rules(db: Session = Depends(get_db)) -> list[PricingRuleRead]:
    rules = pricing_service.ensure_defaults(db)
    rules.sort(
        key=lambda rule: (
            rule.pricing_category.sort_order,
            rule.pricing_category.name,
            rule.paper_size.value,
            rule.print_type_definition.sort_order,
        )
    )
    return [pricing_service.to_read(rule) for rule in rules]


@router.put("/pricing-rules", response_model=list[PricingRuleRead])
def update_pricing_rules(
    payload: PricingRulesUpdate,
    db: Session = Depends(get_db),
) -> list[PricingRuleRead]:
    rule_ids = [item.id for item in payload.rules]
    if len(rule_ids) != len(set(rule_ids)):
        raise HTTPException(status_code=409, detail="Each pricing rule can be updated only once.")
    rules = db.query(DocumentPricingRule).filter(DocumentPricingRule.id.in_(rule_ids)).all()
    by_id = {rule.id: rule for rule in rules}
    if missing_ids := set(rule_ids) - set(by_id):
        raise HTTPException(status_code=404, detail=f"Pricing rule not found: {next(iter(missing_ids))}.")
    for item in payload.rules:
        rule = by_id[item.id]
        rule.price_per_page = item.price_per_page
        rule.is_active = item.is_active
    db.commit()
    all_rules = pricing_service.ensure_defaults(db)
    all_rules.sort(
        key=lambda rule: (
            rule.pricing_category.sort_order,
            rule.pricing_category.name,
            rule.paper_size.value,
            rule.print_type_definition.sort_order,
        )
    )
    return [pricing_service.to_read(rule) for rule in all_rules]


@router.get("/pricing-variables", response_model=list[GlobalPricingVariableRead])
def list_pricing_variables(db: Session = Depends(get_db)) -> list[GlobalPricingVariable]:
    return db.query(GlobalPricingVariable).order_by(GlobalPricingVariable.sort_order, GlobalPricingVariable.name).all()


@router.post("/pricing-variables", response_model=GlobalPricingVariableRead, status_code=201)
def create_pricing_variable(payload: GlobalPricingVariableCreate, db: Session = Depends(get_db)) -> GlobalPricingVariable:
    name = payload.name.strip()
    if db.query(GlobalPricingVariable).filter(func.lower(GlobalPricingVariable.name) == name.lower()).first():
        raise HTTPException(status_code=409, detail="A global pricing variable with this name already exists.")
    variable = GlobalPricingVariable(
        name=name, calculation_type=payload.calculation_type, value=payload.value,
        is_active=payload.is_active,
        sort_order=(db.query(func.max(GlobalPricingVariable.sort_order)).scalar() or 0) + 1,
    )
    db.add(variable)
    db.commit()
    db.refresh(variable)
    return variable


@router.put("/pricing-variables/{variable_id}", response_model=GlobalPricingVariableRead)
def update_pricing_variable(variable_id: str, payload: GlobalPricingVariableUpdate, db: Session = Depends(get_db)) -> GlobalPricingVariable:
    variable = db.get(GlobalPricingVariable, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Global pricing variable not found.")
    name = payload.name.strip()
    duplicate = db.query(GlobalPricingVariable).filter(
        func.lower(GlobalPricingVariable.name) == name.lower(), GlobalPricingVariable.id != variable_id
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A global pricing variable with this name already exists.")
    variable.name, variable.calculation_type, variable.value, variable.is_active = name, payload.calculation_type, payload.value, payload.is_active
    db.commit()
    db.refresh(variable)
    return variable


@router.delete("/pricing-variables/{variable_id}", status_code=204)
def delete_pricing_variable(variable_id: str, db: Session = Depends(get_db)) -> None:
    variable = db.get(GlobalPricingVariable, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Global pricing variable not found.")
    db.delete(variable)
    db.commit()


def _discount_to_read(discount: PricingDiscount) -> PricingDiscountRead:
    return PricingDiscountRead(
        id=discount.id,
        name=discount.name,
        calculation_type=discount.calculation_type,
        value=discount.value,
        product_ids=[assignment.product_id for assignment in discount.product_assignments],
        is_active=discount.is_active,
        created_at=discount.created_at,
        updated_at=discount.updated_at,
    )


def _validate_discount_products(product_ids: list[str], db: Session) -> None:
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(status_code=409, detail="Each product can be assigned only once.")
    products = db.query(Product).filter(Product.id.in_(product_ids), Product.deleted_at.is_(None)).all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=422, detail="Select existing products for this discount.")


@router.get("/pricing-discounts", response_model=list[PricingDiscountRead])
def list_pricing_discounts(db: Session = Depends(get_db)) -> list[PricingDiscountRead]:
    discounts = db.query(PricingDiscount).order_by(PricingDiscount.sort_order, PricingDiscount.name).all()
    return [_discount_to_read(discount) for discount in discounts]


@router.post("/pricing-discounts", response_model=PricingDiscountRead, status_code=201)
def create_pricing_discount(payload: PricingDiscountCreate, db: Session = Depends(get_db)) -> PricingDiscountRead:
    name = payload.name.strip()
    if db.query(PricingDiscount).filter(func.lower(PricingDiscount.name) == name.lower()).first():
        raise HTTPException(status_code=409, detail="A discount with this name already exists.")
    _validate_discount_products(payload.product_ids, db)
    discount = PricingDiscount(
        name=name, calculation_type=payload.calculation_type, value=payload.value,
        is_active=payload.is_active,
        sort_order=(db.query(func.max(PricingDiscount.sort_order)).scalar() or 0) + 1,
        product_assignments=[PricingDiscountProduct(product_id=product_id) for product_id in payload.product_ids],
    )
    db.add(discount)
    db.commit()
    db.refresh(discount)
    return _discount_to_read(discount)


@router.put("/pricing-discounts/{discount_id}", response_model=PricingDiscountRead)
def update_pricing_discount(discount_id: str, payload: PricingDiscountUpdate, db: Session = Depends(get_db)) -> PricingDiscountRead:
    discount = db.get(PricingDiscount, discount_id)
    if discount is None:
        raise HTTPException(status_code=404, detail="Discount not found.")
    name = payload.name.strip()
    duplicate = db.query(PricingDiscount).filter(func.lower(PricingDiscount.name) == name.lower(), PricingDiscount.id != discount_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A discount with this name already exists.")
    _validate_discount_products(payload.product_ids, db)
    discount.name, discount.calculation_type, discount.value, discount.is_active = name, payload.calculation_type, payload.value, payload.is_active
    discount.product_assignments = [PricingDiscountProduct(product_id=product_id) for product_id in payload.product_ids]
    db.commit()
    db.refresh(discount)
    return _discount_to_read(discount)


@router.delete("/pricing-discounts/{discount_id}", status_code=204)
def delete_pricing_discount(discount_id: str, db: Session = Depends(get_db)) -> None:
    discount = db.get(PricingDiscount, discount_id)
    if discount is None:
        raise HTTPException(status_code=404, detail="Discount not found.")
    db.delete(discount)
    db.commit()


def _category_to_read(category: PricingCategory, db: Session) -> PricingCategoryRead:
    return PricingCategoryRead(
        key=category.key,
        name=category.name,
        description=category.description,
        operation_kind=category.operation_kind,
        material_ids=[assignment.inventory_item_id for assignment in category.material_assignments],
        is_builtin=category.is_builtin,
        is_active=category.is_active,
        linked_product_count=db.query(Product).filter(Product.pricing_category_key == category.key).count(),
        created_at=category.created_at,
        updated_at=category.updated_at,
    )


def _validated_category_materials(
    material_ids: list[str], db: Session, *, allowed_inactive_ids: set[str] | None = None
) -> list[InventoryItem]:
    if len(material_ids) != len(set(material_ids)):
        raise HTTPException(status_code=409, detail="Each material can be assigned only once.")
    if not material_ids:
        return []
    items = db.query(InventoryItem).filter(InventoryItem.id.in_(material_ids)).all()
    by_id = {item.id: item for item in items}
    if missing := set(material_ids) - set(by_id):
        raise HTTPException(status_code=404, detail=f"Inventory material not found: {next(iter(missing))}.")
    allowed_inactive_ids = allowed_inactive_ids or set()
    if invalid := next((
        item for item in items
        if item.paper_size is None or (not item.is_active and item.id not in allowed_inactive_ids)
    ), None):
        raise HTTPException(
            status_code=422,
            detail=f"{invalid.name} must be active and have a paper size before it can be priced.",
        )
    return items


@router.get("/pricing-categories", response_model=list[PricingCategoryRead])
def list_pricing_categories(db: Session = Depends(get_db)) -> list[PricingCategoryRead]:
    categories = pricing_service.ensure_builtin_categories(db)
    return [_category_to_read(category, db) for category in categories]


@router.post("/pricing-categories", response_model=PricingCategoryRead, status_code=201)
def create_pricing_category(
    payload: PricingCategoryCreate, db: Session = Depends(get_db)
) -> PricingCategoryRead:
    name = payload.name.strip()
    if db.query(PricingCategory).filter(func.lower(PricingCategory.name) == name.lower()).first():
        raise HTTPException(status_code=409, detail="A pricing category with this name already exists.")
    _validated_category_materials(payload.material_ids, db)
    category = PricingCategory(
        name=name,
        description=payload.description.strip() if payload.description else None,
        operation_kind=payload.operation_kind,
        is_builtin=False,
        is_active=True,
        sort_order=(db.query(func.max(PricingCategory.sort_order)).scalar() or 0) + 1,
    )
    assignments_by_material = {
        assignment.inventory_item_id: assignment
        for assignment in category.material_assignments
    }
    for material_id, assignment in assignments_by_material.items():
        if material_id not in payload.material_ids:
            category.material_assignments.remove(assignment)
    for material_id in payload.material_ids:
        if material_id not in assignments_by_material:
            category.material_assignments.append(
                PricingCategoryMaterial(inventory_item_id=material_id)
            )
    db.add(category)
    db.commit()
    db.refresh(category)
    pricing_service.ensure_defaults(db)
    db.refresh(category)
    return _category_to_read(category, db)


@router.put("/pricing-categories/{category_key}", response_model=PricingCategoryRead)
def update_pricing_category(
    category_key: str,
    payload: PricingCategoryUpdate,
    db: Session = Depends(get_db),
) -> PricingCategoryRead:
    category = db.get(PricingCategory, category_key)
    if category is None:
        raise HTTPException(status_code=404, detail="Pricing category not found.")
    name = payload.name.strip()
    duplicate = db.query(PricingCategory).filter(
        func.lower(PricingCategory.name) == name.lower(),
        PricingCategory.key != category.key,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A pricing category with this name already exists.")
    if category.is_builtin and payload.operation_kind != category.operation_kind:
        raise HTTPException(status_code=422, detail="A built-in category's workflow cannot be changed.")
    if payload.operation_kind != category.operation_kind and category.products:
        raise HTTPException(status_code=409, detail="Move linked products before changing this category's workflow.")
    existing_material_ids = {
        assignment.inventory_item_id for assignment in category.material_assignments
    }
    _validated_category_materials(
        payload.material_ids, db, allowed_inactive_ids=existing_material_ids
    )
    removed_ids = {
        assignment.inventory_item_id for assignment in category.material_assignments
    } - set(payload.material_ids)
    if removed_ids:
        used = db.query(ProductMaterialAssignment).join(Product).filter(
            Product.pricing_category_key == category.key,
            ProductMaterialAssignment.inventory_item_id.in_(removed_ids),
            Product.deleted_at.is_(None),
        ).first()
        if used:
            raise HTTPException(
                status_code=409,
                detail="A linked product still uses one of the materials being removed.",
            )
    category.name = name
    category.description = payload.description.strip() if payload.description else None
    category.operation_kind = payload.operation_kind
    category.is_active = payload.is_active
    assignments_by_material = {
        assignment.inventory_item_id: assignment
        for assignment in category.material_assignments
    }
    for material_id, assignment in assignments_by_material.items():
        if material_id not in payload.material_ids:
            category.material_assignments.remove(assignment)
    for material_id in payload.material_ids:
        if material_id not in assignments_by_material:
            category.material_assignments.append(
                PricingCategoryMaterial(inventory_item_id=material_id)
            )
    db.commit()
    pricing_service.ensure_defaults(db)
    db.refresh(category)
    return _category_to_read(category, db)


def _to_scan_tier_read(tier: ScanPricingTier) -> ScanPricingTierRead:
    return ScanPricingTierRead(
        id=tier.id,
        min_pages=tier.min_pages,
        max_pages=tier.max_pages,
        price_per_page=tier.price_per_page,
        is_active=tier.is_active,
    )


@router.get("/scan-pricing-tiers", response_model=list[ScanPricingTierRead])
def list_scan_pricing_tiers(db: Session = Depends(get_db)) -> list[ScanPricingTierRead]:
    tiers = db.query(ScanPricingTier).order_by(ScanPricingTier.min_pages).all()
    return [_to_scan_tier_read(tier) for tier in tiers]


@router.post("/scan-pricing-tiers", response_model=ScanPricingTierRead, status_code=201)
def create_scan_pricing_tier(payload: ScanPricingTierCreate, db: Session = Depends(get_db)) -> ScanPricingTierRead:
    if payload.max_pages is not None and payload.max_pages < payload.min_pages:
        raise HTTPException(status_code=422, detail="The page range's upper bound must be at or above its lower bound.")
    if scan_tier_ranges_overlap(payload.min_pages, payload.max_pages, db):
        raise HTTPException(status_code=409, detail="This page range overlaps an existing scan pricing tier.")
    tier = ScanPricingTier(
        min_pages=payload.min_pages,
        max_pages=payload.max_pages,
        price_per_page=payload.price_per_page,
        is_active=payload.is_active,
    )
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return _to_scan_tier_read(tier)


@router.put("/scan-pricing-tiers/{tier_id}", response_model=ScanPricingTierRead)
def update_scan_pricing_tier(
    tier_id: str, payload: ScanPricingTierUpdate, db: Session = Depends(get_db)
) -> ScanPricingTierRead:
    tier = db.get(ScanPricingTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="Scan pricing tier not found.")
    if payload.max_pages is not None and payload.max_pages < payload.min_pages:
        raise HTTPException(status_code=422, detail="The page range's upper bound must be at or above its lower bound.")
    if scan_tier_ranges_overlap(payload.min_pages, payload.max_pages, db, exclude_id=tier_id):
        raise HTTPException(status_code=409, detail="This page range overlaps another scan pricing tier.")
    tier.min_pages = payload.min_pages
    tier.max_pages = payload.max_pages
    tier.price_per_page = payload.price_per_page
    tier.is_active = payload.is_active
    db.commit()
    db.refresh(tier)
    return _to_scan_tier_read(tier)


@router.delete("/scan-pricing-tiers/{tier_id}", status_code=204)
def delete_scan_pricing_tier(tier_id: str, db: Session = Depends(get_db)) -> None:
    tier = db.get(ScanPricingTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="Scan pricing tier not found.")
    db.delete(tier)
    db.commit()
