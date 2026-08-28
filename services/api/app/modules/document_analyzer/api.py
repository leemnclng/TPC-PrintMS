from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.security import require_token
from app.db.models import DocumentPricingRule, Product, ProductMaterialAssignment, ProductVariant
from app.db.session import get_db

from .analyzers.base import InvalidDocumentError
from .models.document_analysis import AnalysisResponse
from .models.pricing_result import PricingContext, PricingRuleRead, PricingRulesUpdate
from .services.analysis_service import AnalysisService
from .services.pricing_service import PricingService
from .utils.file_detection import (
    MAX_FILE_SIZE_BYTES,
    UnsafeArchiveError,
    UnsupportedFileTypeError,
)

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


@router.get("/pricing-rules", response_model=list[PricingRuleRead])
def list_pricing_rules(db: Session = Depends(get_db)) -> list[PricingRuleRead]:
    rules = pricing_service.ensure_defaults(db)
    rules.sort(key=lambda rule: (rule.paper_size.value, rule.print_type_definition.sort_order))
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
    all_rules.sort(key=lambda rule: (rule.paper_size.value, rule.print_type_definition.sort_order))
    return [pricing_service.to_read(rule) for rule in all_rules]
