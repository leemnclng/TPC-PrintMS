from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..core.config import settings
from ..core.security import require_token
from ..db.models import (
    BusinessProfile,
    Customer,
    InventoryMovement,
    InventoryMovementKind,
    JobFile,
    JobOrder,
    JobOrderItem,
    JobOrderMaterialPlan,
    Product,
    ProductVariant,
)
from ..db.session import get_db
from ..schemas.inventory import InventoryMovementRead
from ..modules.document_analyzer.analyzers.base import InvalidDocumentError
from ..modules.document_analyzer.services.analysis_service import AnalysisService
from ..modules.document_analyzer.services.pricing_service import PricingService
from ..modules.document_analyzer.utils.file_detection import (
    MAX_FILE_SIZE_BYTES,
    UnsafeArchiveError,
    UnsupportedFileTypeError,
)
from ..schemas.job_orders import AnalyzedJobOrderCreate, JobOrderCreate, JobOrderMaterialUsageCreate, JobOrderRead
from ..services.product_pricing import price_per_page_for_material, reference_price_per_page

router = APIRouter(prefix="/job-orders", tags=["job-orders"], dependencies=[Depends(require_token)])
analysis_service = AnalysisService()
pricing_service = PricingService()


def _to_read(job_order: JobOrder) -> JobOrderRead:
    return JobOrderRead(
        id=job_order.id,
        number=job_order.number,
        customer_id=job_order.customer_id,
        customer_name=job_order.customer.display_name if job_order.customer else None,
        quotation_id=job_order.quotation_id,
        status=job_order.status,
        total=job_order.total,
        suggested_total=job_order.suggested_total,
        price_overridden=job_order.price_overridden,
        amount_paid=sum(payment.amount for payment in job_order.payments if payment.verified),
        due_date=job_order.due_date,
        notes=job_order.notes,
        assigned_printer_id=job_order.assigned_printer_id,
        items=[
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product.name,
                "service_name": item.product.service.name,
                "variant_label": item.variant_label,
                "pages_per_copy": item.pages_per_copy,
                "copies": item.copies,
                "unit_price": item.unit_price,
                "line_total": item.line_total,
                "print_sides": item.print_sides,
                "materials": [
                    {
                        "id": plan.id,
                        "inventory_item_id": plan.inventory_item_id,
                        "inventory_item_name": plan.inventory_item.name,
                        "inventory_item_unit": plan.inventory_item.unit,
                        "quantity_on_hand": plan.inventory_item.quantity_on_hand,
                        "planned_quantity": plan.planned_quantity,
                        "consumed_quantity": plan.consumed_quantity,
                    }
                    for plan in item.material_plans
                ],
            }
            for item in job_order.items
        ],
        files=[
            {
                "id": file.id,
                "original_filename": file.original_filename,
                "kind": file.kind,
                "size_bytes": file.size_bytes,
                "uploaded_at": file.uploaded_at,
            }
            for file in job_order.files
        ],
        created_at=job_order.created_at,
        updated_at=job_order.updated_at,
    )


@router.get("", response_model=list[JobOrderRead])
def list_job_orders(db: Session = Depends(get_db)) -> list[JobOrderRead]:
    return [_to_read(job_order) for job_order in db.query(JobOrder).order_by(JobOrder.created_at.desc()).all()]


@router.get("/{job_order_id}", response_model=JobOrderRead)
def get_job_order(job_order_id: str, db: Session = Depends(get_db)) -> JobOrderRead:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    return _to_read(job_order)


@router.get("/{job_order_id}/files/{file_id}")
def download_job_file(job_order_id: str, file_id: str, db: Session = Depends(get_db)) -> FileResponse:
    job_file = db.get(JobFile, file_id)
    if not job_file or job_file.job_order_id != job_order_id:
        raise HTTPException(status_code=404, detail="Job file not found.")
    files_root = (settings.resolved_data_dir / "files").resolve()
    stored_path = (settings.resolved_data_dir / job_file.stored_path).resolve()
    if files_root not in stored_path.parents or not stored_path.is_file():
        raise HTTPException(status_code=404, detail="The stored job file is unavailable.")
    return FileResponse(stored_path, filename=job_file.original_filename)


@router.post("/from-analysis", response_model=JobOrderRead, status_code=201)
async def create_analyzed_job_order(
    file: UploadFile = File(...),
    transaction: str = Form(...),
    db: Session = Depends(get_db),
) -> JobOrderRead:
    try:
        payload = AnalyzedJobOrderCreate.model_validate_json(transaction)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="The transaction details are incomplete or invalid.") from error
    if payload.price_mode == "custom" and payload.custom_price is None:
        raise HTTPException(status_code=422, detail="Enter the owner's final price.")

    product = db.get(Product, payload.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if not product.is_active:
        raise HTTPException(status_code=409, detail=f"Product is inactive: {product.name}.")
    variant: ProductVariant | None = None
    if payload.variant_id:
        variant = (
            db.query(ProductVariant)
            .filter(ProductVariant.product_id == product.id, ProductVariant.variant_id == payload.variant_id)
            .one_or_none()
        )
        if variant is None:
            raise HTTPException(status_code=404, detail="Variant is not assigned to the selected product.")

    filename = Path(file.filename or "document").name
    content_type = file.content_type or ""
    data = await file.read(MAX_FILE_SIZE_BYTES + 1)
    await file.close()
    if not data:
        raise HTTPException(status_code=422, detail="Select a non-empty document.")
    if len(data) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Documents must be 25 MB or smaller.")
    try:
        analysis = await run_in_threadpool(analysis_service.analyze, filename, data, content_type)
    except UnsupportedFileTypeError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except (InvalidDocumentError, UnsafeArchiveError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    paper_assignment = next(
        (
            assignment
            for assignment in product.material_assignments
            if assignment.inventory_item.is_active
            and assignment.inventory_item.paper_size is not None
            and assignment.inventory_item.paper_size.value == analysis.paper_size.value
        ),
        None,
    )
    if paper_assignment is None:
        raise HTTPException(
            status_code=422,
            detail=f"{product.name} is not configured for the detected {analysis.paper_size.value} paper size.",
        )

    pricing = pricing_service.calculate(analysis, db, product, variant)
    suggested_total = round(pricing.suggested_price * payload.copies, 2)
    final_total = suggested_total if payload.price_mode == "suggested" else round(payload.custom_price or 0, 2)
    paper_quantity = analysis.page_count * payload.copies
    if "sheet" not in paper_assignment.inventory_item.unit.lower():
        paper_quantity = 1
    order_payload = JobOrderCreate(
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        notes=payload.notes,
        items=[
            {
                "product_id": product.id,
                "variant_label": variant.label if variant else None,
                "pages_per_copy": analysis.page_count,
                "copies": payload.copies,
                "materials": [
                    {
                        "inventory_item_id": paper_assignment.inventory_item_id,
                        "planned_quantity": paper_quantity,
                    },
                    *[material.model_dump() for material in payload.other_materials],
                ],
            }
        ],
    )

    created = create_job_order(order_payload, db)
    job_order = db.get(JobOrder, created.id)
    if job_order is None:
        raise HTTPException(status_code=500, detail="The job order could not be finalized.")

    storage_directory = settings.resolved_data_dir / "files" / job_order.id
    stored_filename = f"{uuid4().hex}-{filename}"
    stored_path = storage_directory / stored_filename
    try:
        storage_directory.mkdir(parents=True, exist_ok=False)
        stored_path.write_bytes(data)
        relative_path = stored_path.relative_to(settings.resolved_data_dir)
        job_order.suggested_total = suggested_total
        job_order.price_overridden = payload.price_mode == "custom"
        job_order.total = final_total
        billable_quantity = max(analysis.page_count * payload.copies, 1)
        job_order.items[0].unit_price = round(final_total / billable_quantity, 2)
        job_order.items[0].line_total = final_total
        job_order.files.append(
            JobFile(
                original_filename=filename,
                stored_path=str(relative_path),
                kind="print_ready",
                size_bytes=len(data),
            )
        )
        db.commit()
        db.refresh(job_order)
    except Exception as error:
        db.rollback()
        persisted = db.get(JobOrder, job_order.id)
        if persisted is not None:
            db.delete(persisted)
            db.commit()
        shutil.rmtree(storage_directory, ignore_errors=True)
        raise HTTPException(status_code=500, detail="The confirmed transaction could not be saved.") from error
    return _to_read(job_order)


@router.post("", response_model=JobOrderRead, status_code=201)
def create_job_order(payload: JobOrderCreate, db: Session = Depends(get_db)) -> JobOrderRead:
    if payload.customer_id and not db.get(Customer, payload.customer_id):
        raise HTTPException(status_code=404, detail="Customer not found.")

    product_ids = {item.product_id for item in payload.items}
    products = db.query(Product).filter(Product.id.in_(product_ids)).all()
    product_by_id = {product.id: product for product in products}
    if missing_product_ids := product_ids - set(product_by_id):
        raise HTTPException(status_code=404, detail=f"Product not found: {next(iter(missing_product_ids))}.")

    for item_payload in payload.items:
        product = product_by_id[item_payload.product_id]
        if not product.is_active:
            raise HTTPException(status_code=409, detail=f"Product is inactive: {product.name}.")
        variant_label = item_payload.variant_label.strip() if item_payload.variant_label else None
        if variant_label and variant_label not in {variant.label for variant in product.variants}:
            raise HTTPException(status_code=400, detail=f"Variant is not available for {product.name}.")
        material_ids = [material.inventory_item_id for material in item_payload.materials]
        if len(material_ids) != len(set(material_ids)):
            raise HTTPException(status_code=400, detail="A material can appear only once per product line.")
        assigned_by_id = {
            assignment.inventory_item_id: assignment.inventory_item
            for assignment in product.material_assignments
        }
        if unassigned_ids := set(material_ids) - set(assigned_by_id):
            raise HTTPException(
                status_code=400,
                detail=f"Material is not assigned to {product.name}: {next(iter(unassigned_ids))}.",
            )
        inactive_material = next(
            (assigned_by_id[material_id] for material_id in material_ids if not assigned_by_id[material_id].is_active),
            None,
        )
        if inactive_material:
            raise HTTPException(status_code=409, detail=f"Inventory item is inactive: {inactive_material.name}.")
        selected_paper_ids = [
            material_id for material_id in material_ids if assigned_by_id[material_id].paper_size is not None
        ]
        if len(selected_paper_ids) > 1:
            raise HTTPException(
                status_code=422,
                detail=f"Select only one priced paper material for {product.name}; use another product line for a second paper size.",
            )
        overrides = {rate.pricing_rule_id: rate.price_per_page for rate in product.document_rates}
        active_paper_ids = [
            material_id
            for material_id, material in assigned_by_id.items()
            if material.is_active and material.paper_size is not None
        ]
        configured_paper_ids = [
            material_id
            for material_id in active_paper_ids
            if price_per_page_for_material(product.print_type, overrides, material_id, db) is not None
        ]
        if active_paper_ids and not configured_paper_ids:
            raise HTTPException(
                status_code=422,
                detail=f"{product.name} has no active configured paper price.",
            )
        if configured_paper_ids and not selected_paper_ids:
            raise HTTPException(
                status_code=422,
                detail=f"Select one configured paper size for {product.name}.",
            )
        if selected_paper_ids and selected_paper_ids[0] not in configured_paper_ids:
            raise HTTPException(
                status_code=422,
                detail=f"The selected paper size has no active configured price for {product.name}.",
            )

    job_order = JobOrder(
        number=_next_job_order_number(db),
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        total=0,
        notes=payload.notes.strip() if payload.notes else None,
    )
    for item_payload in payload.items:
        product = product_by_id[item_payload.product_id]
        variant_label = item_payload.variant_label.strip() if item_payload.variant_label else None
        variant = next((candidate for candidate in product.variants if candidate.label == variant_label), None)
        overrides = {rate.pricing_rule_id: rate.price_per_page for rate in product.document_rates}
        material_ids = [material.inventory_item_id for material in item_payload.materials]
        priced_material_ids = [
            material_id
            for material_id in material_ids
            if next(
                assignment.inventory_item.paper_size
                for assignment in product.material_assignments
                if assignment.inventory_item_id == material_id
            ) is not None
        ]
        reference_price = (
            price_per_page_for_material(product.print_type, overrides, priced_material_ids[0], db)
            if priced_material_ids
            else reference_price_per_page(
                product.print_type,
                overrides,
                [assignment.inventory_item_id for assignment in product.material_assignments],
                db,
            )
        )
        reference_price = reference_price if reference_price is not None else 0.0
        unit_price = round(reference_price + (variant.price_adjustment if variant else 0), 2)
        if unit_price < 0:
            raise HTTPException(
                status_code=422,
                detail=f"The final unit price for {product.name} cannot be negative.",
            )
        line_total = round(unit_price * item_payload.pages_per_copy * item_payload.copies, 2)
        item = JobOrderItem(
            product_id=item_payload.product_id,
            variant_label=variant_label,
            pages_per_copy=item_payload.pages_per_copy,
            copies=item_payload.copies,
            unit_price=unit_price,
            line_total=line_total,
            print_sides=item_payload.print_sides,
        )
        item.material_plans = [
            JobOrderMaterialPlan(
                inventory_item_id=material.inventory_item_id,
                planned_quantity=material.planned_quantity,
            )
            for material in item_payload.materials
        ]
        job_order.items.append(item)
        job_order.total = round(job_order.total + line_total, 2)
    db.add(job_order)
    db.commit()
    db.refresh(job_order)
    return _to_read(job_order)


@router.post(
    "/{job_order_id}/material-usage",
    response_model=list[InventoryMovementRead],
    status_code=201,
)
def record_material_usage(
    job_order_id: str,
    payload: JobOrderMaterialUsageCreate,
    db: Session = Depends(get_db),
) -> list[InventoryMovementRead]:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    plan_ids = [entry.material_plan_id for entry in payload.entries]
    if len(plan_ids) != len(set(plan_ids)):
        raise HTTPException(status_code=400, detail="A material plan can be recorded only once per request.")

    plans = db.query(JobOrderMaterialPlan).filter(JobOrderMaterialPlan.id.in_(plan_ids)).all()
    plan_by_id = {plan.id: plan for plan in plans}
    if missing_plan_ids := set(plan_ids) - set(plan_by_id):
        raise HTTPException(status_code=404, detail=f"Material plan not found: {next(iter(missing_plan_ids))}.")
    if any(plan.job_order_item.job_order_id != job_order_id for plan in plans):
        raise HTTPException(status_code=400, detail=f"A material plan does not belong to {job_order.number}.")

    requested_by_inventory: dict[str, float] = defaultdict(float)
    for entry in payload.entries:
        requested_by_inventory[plan_by_id[entry.material_plan_id].inventory_item_id] += entry.quantity_used
    for inventory_item_id, requested_quantity in requested_by_inventory.items():
        inventory_item = next(plan.inventory_item for plan in plans if plan.inventory_item_id == inventory_item_id)
        if requested_quantity > inventory_item.quantity_on_hand:
            raise HTTPException(status_code=409, detail=f"Not enough {inventory_item.name} in stock.")

    note = payload.note.strip() if payload.note else f"Material used for {job_order.number}"
    movements: list[InventoryMovement] = []
    for entry in payload.entries:
        plan = plan_by_id[entry.material_plan_id]
        inventory_item = plan.inventory_item
        balance_after = inventory_item.quantity_on_hand - entry.quantity_used
        inventory_item.quantity_on_hand = balance_after
        plan.consumed_quantity += entry.quantity_used
        movement = InventoryMovement(
            inventory_item_id=inventory_item.id,
            kind=InventoryMovementKind.job_usage,
            quantity_delta=-entry.quantity_used,
            balance_after=balance_after,
            job_order_id=job_order_id,
            product_id=plan.job_order_item.product_id,
            note=note,
        )
        db.add(movement)
        movements.append(movement)
    db.commit()
    for movement in movements:
        db.refresh(movement)
    return [_movement_to_read(movement) for movement in movements]


def _next_job_order_number(db: Session) -> str:
    profile = db.query(BusinessProfile).first()
    prefix = (profile.job_order_prefix if profile else "JOB").strip() or "JOB"
    sequence = (db.query(func.count(JobOrder.id)).scalar() or 0) + 1
    while db.query(JobOrder.id).filter(JobOrder.number == f"{prefix}-{sequence:04d}").first():
        sequence += 1
    return f"{prefix}-{sequence:04d}"


def _movement_to_read(movement: InventoryMovement) -> InventoryMovementRead:
    return InventoryMovementRead(
        id=movement.id,
        inventory_item_id=movement.inventory_item_id,
        inventory_item_name=movement.inventory_item.name,
        inventory_item_unit=movement.inventory_item.unit,
        kind=movement.kind,
        quantity_delta=movement.quantity_delta,
        balance_after=movement.balance_after,
        job_order_id=movement.job_order_id,
        product_id=movement.product_id,
        note=movement.note,
        occurred_at=movement.occurred_at,
    )
