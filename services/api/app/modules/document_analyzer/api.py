from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.security import require_token
from app.db.models import DocumentPricingRule, Product
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


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_document(
    file: UploadFile = File(...),
    product_id: str | None = Form(None),
    db: Session = Depends(get_db),
) -> AnalysisResponse:
    product: Product | None = None
    if product_id:
        product = db.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")

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
    return AnalysisResponse(
        analysis=analysis,
        pricing=pricing_service.calculate(analysis, db, product),
        pricing_context=PricingContext(product_id=product.id, product_name=product.name) if product else None,
    )


@router.get("/pricing-rules", response_model=list[PricingRuleRead])
def list_pricing_rules(db: Session = Depends(get_db)) -> list[PricingRuleRead]:
    rules = pricing_service.ensure_defaults(db)
    rules.sort(key=lambda rule: (rule.paper_size, rule.print_type.value))
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
    all_rules.sort(key=lambda rule: (rule.paper_size, rule.print_type.value))
    return [pricing_service.to_read(rule) for rule in all_rules]
