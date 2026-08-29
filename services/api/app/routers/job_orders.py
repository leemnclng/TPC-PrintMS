from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import shutil
from uuid import uuid4

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func, update
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
    JobOrderNumberSequence,
    JobOrderStatus,
    JobOrderItem,
    JobOrderMaterialPlan,
    ObservedPrintJob,
    Payment,
    Printer,
    PrintJob,
    PrintResult,
    Product,
    ProductVariant,
    Service,
    StatusEvent,
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
from ..schemas.job_orders import (
    AnalyzedJobOrderCreate,
    JobOrderCreate,
    JobOrderMaterialUsageCreate,
    JobOrderRead,
    JobOrderTransitionCreate,
    PaymentCreate,
    PhotocopyJobOrderCreate,
    PrintSubmissionCreate,
    ScanJobOrderCreate,
)
from ..services.printing.adapter import PrintSubmissionError, get_printer_adapter
from ..services.product_pricing import price_per_page_for_material, reference_price_per_page

router = APIRouter(prefix="/job-orders", tags=["job-orders"], dependencies=[Depends(require_token)])
analysis_service = AnalysisService()
pricing_service = PricingService()


def _to_read(job_order: JobOrder) -> JobOrderRead:
    return JobOrderRead(
        id=job_order.id,
        number=job_order.number,
        name=job_order.name,
        workflow_category=job_order.workflow_category,
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
                "operation_kind": item.operation_kind,
                "print_type": item.product.print_type,
                "print_type_label": item.product.print_type_definition.label,
                "print_color_mode": item.product.print_type_definition.color_mode,
                "variant_label": item.variant_label,
                "pages_per_copy": item.pages_per_copy,
                "copies": item.copies,
                "unit_price": item.unit_price,
                "line_total": item.line_total,
                "print_sides": item.print_sides,
                "requires_manual_duplex": item.requires_manual_duplex,
                "materials": [
                    {
                        "id": plan.id,
                        "inventory_item_id": plan.inventory_item_id,
                        "inventory_item_name": plan.inventory_item.name,
                        "inventory_item_unit": plan.inventory_item.unit,
                        "quantity_on_hand": plan.inventory_item.quantity_on_hand,
                        "planned_quantity": plan.planned_quantity,
                        "consumed_quantity": plan.consumed_quantity,
                        "paper_size": plan.inventory_item.paper_size,
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
                "detected_page_count": file.detected_page_count,
                "detected_paper_size": file.detected_paper_size,
                "detected_orientation": file.detected_orientation,
                "detected_color_pages": file.detected_color_pages,
                "detected_bw_pages": file.detected_bw_pages,
                "estimated_color_coverage_percent": file.estimated_color_coverage_percent,
                "estimated_ink_coverage_percent": file.estimated_ink_coverage_percent,
                "estimated_print_time_seconds": file.estimated_print_time_seconds,
                "analysis_confidence": file.analysis_confidence,
                "uploaded_at": file.uploaded_at,
            }
            for file in job_order.files
        ],
        payments=[
            {
                "id": payment.id,
                "amount": payment.amount,
                "method": payment.method,
                "verified": payment.verified,
                "recorded_at": payment.recorded_at,
            }
            for payment in sorted(job_order.payments, key=lambda item: item.recorded_at, reverse=True)
        ],
        print_attempts=[
            {
                "id": attempt.id,
                "printer_id": attempt.printer_id,
                "printer_name": attempt.printer.display_name,
                "job_file_id": attempt.job_file_id,
                "filename": attempt.job_file.original_filename if attempt.job_file else None,
                "copies": attempt.copies,
                "color_mode": attempt.color_mode,
                "media_size": attempt.media_size,
                "orientation": attempt.orientation,
                "scaling": attempt.scaling,
                "quality": attempt.quality,
                "borderless": attempt.borderless,
                "collate": attempt.collate,
                "duplex_pass": attempt.duplex_pass,
                "submitted_at": attempt.submitted_at,
                "result": attempt.result,
                "operator": attempt.operator,
                "external_job_id": attempt.external_job_id,
                "spooler_status": attempt.spooler_status,
                "spooler_pages_printed": attempt.spooler_pages_printed,
                "spooler_total_pages": attempt.spooler_total_pages,
                "spooler_last_seen_at": attempt.spooler_last_seen_at,
                "spooler_released_at": attempt.spooler_released_at,
                "error_message": attempt.error_message,
            }
            for attempt in sorted(job_order.print_jobs, key=lambda item: item.submitted_at, reverse=True)
        ],
        status_events=[
            {
                "id": event.id,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "note": event.note,
                "occurred_at": event.occurred_at,
            }
            for event in sorted(job_order.status_events, key=lambda item: item.occurred_at, reverse=True)
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


@router.post("/from-photocopy", response_model=JobOrderRead, status_code=201)
def create_photocopy_job_order(
    payload: PhotocopyJobOrderCreate,
    db: Session = Depends(get_db),
) -> JobOrderRead:
    service = db.get(Service, payload.service_id)
    if not service or service.category != "photocopy":
        raise HTTPException(status_code=422, detail="Select a service in the Photocopy category.")
    if not service.is_active:
        raise HTTPException(status_code=409, detail=f"Service is inactive: {service.name}.")
    product = db.get(Product, payload.product_id)
    if not product or product.service_id != service.id:
        raise HTTPException(status_code=404, detail="Photocopy product not found in the selected service.")
    if not product.is_active:
        raise HTTPException(status_code=409, detail=f"Product is inactive: {product.name}.")
    if product.operation_kind != "photocopy":
        raise HTTPException(status_code=422, detail="Select a Photocopy product for this transaction.")
    paper_assignment = next(
        (
            assignment
            for assignment in product.material_assignments
            if assignment.inventory_item_id == payload.paper_inventory_item_id
            and assignment.inventory_item.is_active
            and assignment.inventory_item.paper_size is not None
        ),
        None,
    )
    if paper_assignment is None:
        raise HTTPException(status_code=422, detail="Select an active paper configured for this photocopy product.")
    duplex_variant = next(
        (variant for variant in product.variants if variant.requires_manual_duplex),
        None,
    )
    if payload.back_to_back and duplex_variant is None:
        raise HTTPException(
            status_code=422,
            detail="Assign a Back-to-Back variant to this product before recording a two-sided photocopy.",
        )
    selected_variant = duplex_variant if payload.back_to_back else None
    overrides = {rate.pricing_rule_id: rate.price_per_page for rate in product.document_rates}
    base_rate = price_per_page_for_material(
        product.print_type,
        overrides,
        paper_assignment.inventory_item_id,
        db,
        require_override=product.print_type == "black_and_white",
    )
    if base_rate is None:
        raise HTTPException(
            status_code=422,
            detail=f"Set a custom photocopy price for {paper_assignment.inventory_item.name}.",
        )
    price_per_page = round(base_rate + (selected_variant.price_adjustment if selected_variant else 0), 2)
    if price_per_page < 0:
        raise HTTPException(status_code=422, detail="The configured photocopy price cannot be negative.")
    physical_sheets = (
        (payload.pages_per_copy + 1) // 2 if payload.back_to_back else payload.pages_per_copy
    ) * payload.copies
    if "sheet" not in paper_assignment.inventory_item.unit.lower():
        physical_sheets = 1
    if physical_sheets > paper_assignment.inventory_item.quantity_on_hand:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Not enough {paper_assignment.inventory_item.name}. Required {physical_sheets:g} "
                f"{paper_assignment.inventory_item.unit}; available "
                f"{paper_assignment.inventory_item.quantity_on_hand:g}."
            ),
        )

    created = _create_job_order(
        JobOrderCreate(
            name=payload.name,
            customer_id=payload.customer_id,
            due_date=payload.due_date,
            notes=payload.notes,
            items=[
                {
                    "product_id": product.id,
                    "variant_label": selected_variant.label if selected_variant else None,
                    "pages_per_copy": payload.pages_per_copy,
                    "copies": payload.copies,
                    "print_sides": "double_sided" if payload.back_to_back else "single_sided",
                    "materials": [
                        {
                            "inventory_item_id": paper_assignment.inventory_item_id,
                            "planned_quantity": physical_sheets,
                        }
                    ],
                }
            ],
        ),
        db,
        allow_device_side=True,
    )
    job_order = db.get(JobOrder, created.id)
    if job_order is None:
        raise HTTPException(status_code=500, detail="The photocopy job could not be finalized.")
    pending_materials = _remaining_planned_materials(job_order)
    _validate_material_stock(pending_materials)
    _deduct_planned_materials(
        job_order,
        pending_materials,
        db,
        note=f"Automatically deducted after device-side photocopy work for {job_order.number}",
    )
    _record_status(
        job_order,
        JobOrderStatus.ready,
        "Photocopy transaction recorded after device-side production; ready for payment.",
    )
    db.commit()
    db.refresh(job_order)
    return _to_read(job_order)


async def _read_scan_outputs(uploaded_files: list[UploadFile]) -> tuple[str, bytes, str]:
    if not uploaded_files:
        raise HTTPException(status_code=422, detail="Acquire at least one page from the scanner.")
    if len(uploaded_files) > 1000:
        raise HTTPException(status_code=422, detail="A scan job can contain at most 1,000 acquired files.")

    sources: list[tuple[str, bytes, str]] = []
    total_size = 0
    for uploaded_file in uploaded_files:
        filename = Path(uploaded_file.filename or "scan-page").name
        content_type = uploaded_file.content_type or ""
        remaining = MAX_FILE_SIZE_BYTES - total_size
        data = await uploaded_file.read(remaining + 1)
        await uploaded_file.close()
        if not data:
            raise HTTPException(status_code=422, detail=f"The scanner returned an empty page: {filename}.")
        total_size += len(data)
        if total_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="The combined scan output must be 25 MB or smaller.")
        try:
            await run_in_threadpool(analysis_service.analyze, filename, data, content_type)
        except UnsupportedFileTypeError as error:
            raise HTTPException(status_code=415, detail="Scanner outputs must be PDF or image files.") from error
        except (InvalidDocumentError, UnsafeArchiveError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if Path(filename).suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}:
            raise HTTPException(status_code=415, detail="Scanner outputs must be PDF or image files.")
        sources.append((filename, data, content_type))

    if len(sources) == 1:
        return sources[0]

    combined = pymupdf.open()
    try:
        for filename, data, _content_type in sources:
            suffix = Path(filename).suffix.lower()
            source = pymupdf.open(stream=data, filetype=suffix.removeprefix("."))
            try:
                if suffix == ".pdf":
                    combined.insert_pdf(source)
                else:
                    image_pdf_data = source.convert_to_pdf()
                    image_pdf = pymupdf.open(stream=image_pdf_data, filetype="pdf")
                    try:
                        combined.insert_pdf(image_pdf)
                    finally:
                        image_pdf.close()
            finally:
                source.close()
        return "scanner-output.pdf", combined.tobytes(garbage=4, deflate=True), "application/pdf"
    except Exception as error:
        raise HTTPException(status_code=422, detail="The acquired scanner pages could not be combined into a PDF.") from error
    finally:
        combined.close()


@router.post("/from-scan", response_model=JobOrderRead, status_code=201)
def create_scan_job_order(
    payload: ScanJobOrderCreate,
    db: Session = Depends(get_db),
) -> JobOrderRead:
    """Create the scan job immediately, before any page has been acquired.

    Scanning is not a prerequisite for the job to exist: the job is placed in
    the queue right away, and the owner runs the scanner from inside it via
    `/job-orders/{id}/scan-output`, mirroring how a print job is created
    queued and then submitted to a printer.
    """
    service = db.get(Service, payload.service_id)
    if not service or service.category != "photocopy":
        raise HTTPException(status_code=422, detail="Select the Scan or Photocopy service.")
    if not service.is_active:
        raise HTTPException(status_code=409, detail=f"Service is inactive: {service.name}.")
    product = db.get(Product, payload.product_id)
    if not product or product.service_id != service.id or product.operation_kind != "scan":
        raise HTTPException(status_code=422, detail="Select an active Scan product from this service.")
    if not product.is_active:
        raise HTTPException(status_code=409, detail=f"Product is inactive: {product.name}.")
    if product.standalone_price_per_page is None:
        raise HTTPException(status_code=422, detail="Set this product's scan price per page before creating a job.")

    created = _create_job_order(
        JobOrderCreate(
            name=payload.name,
            customer_id=payload.customer_id,
            due_date=payload.due_date,
            notes=payload.notes,
            # Placeholder pages/copies: the real page count is only known once
            # the document is scanned, which updates this line item in place.
            items=[{"product_id": product.id, "pages_per_copy": 1, "copies": 1, "materials": []}],
        ),
        db,
        allow_device_side=True,
    )
    job_order = db.get(JobOrder, created.id)
    if job_order is None:
        raise HTTPException(status_code=500, detail="The scan job could not be created.")
    return _to_read(job_order)


@router.post("/{job_order_id}/scan-output", response_model=JobOrderRead, status_code=201)
async def submit_scan_output(
    job_order_id: str,
    files: list[UploadFile] | None = File(default=None),
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
) -> JobOrderRead:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    if job_order.status != JobOrderStatus.queued:
        raise HTTPException(status_code=409, detail="This job order is not waiting on a scan.")
    if len(job_order.items) != 1 or job_order.items[0].operation_kind != "scan":
        raise HTTPException(status_code=422, detail="This job order is not a scan job.")
    item = job_order.items[0]
    product = db.get(Product, item.product_id)
    if not product or product.standalone_price_per_page is None:
        raise HTTPException(status_code=422, detail="Set this product's scan price per page before completing this scan.")

    uploaded_files = [*(files or []), *([file] if file else [])]
    filename, data, content_type = await _read_scan_outputs(uploaded_files)
    try:
        analysis = await run_in_threadpool(analysis_service.analyze, filename, data, content_type)
    except UnsupportedFileTypeError as error:
        raise HTTPException(status_code=415, detail="The acquired scanner output must be a PDF or image.") from error
    except (InvalidDocumentError, UnsafeArchiveError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    storage_directory = settings.resolved_data_dir / "files" / job_order.id
    stored_filename = f"{uuid4().hex}-{filename}"
    stored_path = storage_directory / stored_filename
    # A re-scan (after a failed quality check sent the job back to the queue)
    # replaces the prior softcopy rather than accumulating stale deliverables.
    stale_files = [existing for existing in job_order.files if existing.kind == "scan_output"]
    try:
        storage_directory.mkdir(parents=True, exist_ok=True)
        stored_path.write_bytes(data)
        relative_path = stored_path.relative_to(settings.resolved_data_dir)
        for stale in stale_files:
            job_order.files.remove(stale)
            db.delete(stale)
        job_order.files.append(
            JobFile(
                original_filename=filename,
                stored_path=str(relative_path),
                kind="scan_output",
                size_bytes=len(data),
                detected_page_count=analysis.page_count,
                detected_paper_size=analysis.paper_size.value,
                detected_orientation=analysis.orientation.value,
                detected_color_pages=analysis.color_pages,
                detected_bw_pages=analysis.bw_pages,
                estimated_color_coverage_percent=analysis.estimated_color_coverage_percent,
                estimated_ink_coverage_percent=analysis.estimated_ink_coverage_percent,
                analysis_confidence=analysis.confidence,
            )
        )
        item.pages_per_copy = analysis.page_count
        item.unit_price = product.standalone_price_per_page
        item.line_total = round(item.unit_price * analysis.page_count, 2)
        job_order.total = item.line_total
        job_order.suggested_total = job_order.total
        _record_status(job_order, JobOrderStatus.ready, "Scanner softcopy attached; ready for payment and delivery.")
        db.commit()
        db.refresh(job_order)
    except Exception as error:
        db.rollback()
        shutil.rmtree(storage_directory, ignore_errors=True)
        raise HTTPException(status_code=500, detail="The scan output could not be saved.") from error
    for stale in stale_files:
        (settings.resolved_data_dir / stale.stored_path).unlink(missing_ok=True)
    return _to_read(job_order)


def _record_status(job_order: JobOrder, to_status: JobOrderStatus, note: str) -> None:
    from_status = job_order.status
    if from_status == to_status:
        return
    job_order.status = to_status
    job_order.status_events.append(
        StatusEvent(
            from_status=from_status.value if from_status else None,
            to_status=to_status.value,
            note=note,
        )
    )


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

    observed_print_job: ObservedPrintJob | None = None
    if payload.observed_print_job_id:
        observed_print_job = db.get(ObservedPrintJob, payload.observed_print_job_id)
        if not observed_print_job:
            raise HTTPException(status_code=404, detail="Observed Windows print job not found.")
        if observed_print_job.linked_job_order_id:
            raise HTTPException(status_code=409, detail="This Windows print job already has a job order.")

    product = db.get(Product, payload.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if product.service.category != "printing" or product.operation_kind != "printing":
        raise HTTPException(
            status_code=422,
            detail="Uploaded-document jobs require a service in the Printing category.",
        )
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
            if assignment.inventory_item_id == payload.paper_inventory_item_id
            and assignment.inventory_item.is_active
            and assignment.inventory_item.paper_size is not None
        ),
        None,
    )
    if paper_assignment is None:
        raise HTTPException(
            status_code=422,
            detail=f"Select an active paper configured for {product.name}.",
        )

    pricing = pricing_service.calculate(
        analysis,
        db,
        product,
        variant,
        paper_assignment.inventory_item_id,
    )
    if not pricing.breakdown:
        raise HTTPException(
            status_code=422,
            detail=f"The selected {paper_assignment.inventory_item.paper_size.value} paper has no active price for {product.name}.",
        )
    suggested_total = round(pricing.suggested_price * payload.copies, 2)
    final_total = suggested_total if payload.price_mode == "suggested" else round(payload.custom_price or 0, 2)
    requires_manual_duplex = bool(variant and variant.requires_manual_duplex and analysis.page_count > 1)
    paper_quantity = (
        ((analysis.page_count + 1) // 2) if requires_manual_duplex else analysis.page_count
    ) * payload.copies
    if "sheet" not in paper_assignment.inventory_item.unit.lower():
        paper_quantity = 1
    order_payload = JobOrderCreate(
        name=payload.name,
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

    created = _create_job_order(order_payload, db)
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
                detected_page_count=analysis.page_count,
                detected_paper_size=analysis.paper_size.value,
                detected_orientation=analysis.orientation.value,
                detected_color_pages=analysis.color_pages,
                detected_bw_pages=analysis.bw_pages,
                estimated_color_coverage_percent=analysis.estimated_color_coverage_percent,
                estimated_ink_coverage_percent=analysis.estimated_ink_coverage_percent,
                estimated_print_time_seconds=analysis.estimated_print_time_seconds,
                analysis_confidence=analysis.confidence,
            )
        )
        if observed_print_job:
            observed_print_job.review_status = "linked"
            observed_print_job.reviewed_at = datetime.utcnow()
            observed_print_job.linked_job_order_id = job_order.id
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
    return _create_job_order(payload, db)


def _create_job_order(
    payload: JobOrderCreate,
    db: Session,
    *,
    allow_device_side: bool = False,
) -> JobOrderRead:
    job_name = payload.name.strip()
    if not job_name:
        raise HTTPException(status_code=422, detail="Enter a name for this job order.")
    if payload.customer_id and not db.get(Customer, payload.customer_id):
        raise HTTPException(status_code=404, detail="Customer not found.")

    product_ids = {item.product_id for item in payload.items}
    products = db.query(Product).filter(Product.id.in_(product_ids)).all()
    product_by_id = {product.id: product for product in products}
    if missing_product_ids := product_ids - set(product_by_id):
        raise HTTPException(status_code=404, detail=f"Product not found: {next(iter(missing_product_ids))}.")
    workflow_categories = {product.service.category for product in products}
    if len(workflow_categories) != 1:
        raise HTTPException(status_code=422, detail="A job order cannot mix products from different workflow categories.")

    for item_payload in payload.items:
        product = product_by_id[item_payload.product_id]
        if not product.is_active:
            raise HTTPException(status_code=409, detail=f"Product is inactive: {product.name}.")
        variant_label = item_payload.variant_label.strip() if item_payload.variant_label else None
        if product.operation_kind in {"photocopy", "scan"} and not allow_device_side:
            raise HTTPException(status_code=422, detail="Create Scan or Photocopy jobs through their operation-specific workflow.")
        if product.operation_kind == "scan":
            if variant_label or item_payload.materials:
                raise HTTPException(status_code=422, detail="Scan products cannot use print variants or inventory materials.")
            continue
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
            if price_per_page_for_material(
                product.print_type,
                overrides,
                material_id,
                db,
                require_override=product.operation_kind == "photocopy" and product.print_type == "black_and_white",
            ) is not None
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
        name=job_name,
        workflow_category=next(iter(workflow_categories)),
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        total=0,
        status=JobOrderStatus.queued,
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
        reference_price = product.standalone_price_per_page if product.operation_kind == "scan" else (
            price_per_page_for_material(
                product.print_type,
                overrides,
                priced_material_ids[0],
                db,
                require_override=product.operation_kind == "photocopy" and product.print_type == "black_and_white",
            )
            if priced_material_ids
            else reference_price_per_page(
                product.print_type,
                overrides,
                [assignment.inventory_item_id for assignment in product.material_assignments],
                db,
                require_override=product.operation_kind == "photocopy" and product.print_type == "black_and_white",
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
            operation_kind=product.operation_kind,
            variant_label=variant_label,
            pages_per_copy=item_payload.pages_per_copy,
            copies=item_payload.copies,
            unit_price=unit_price,
            line_total=line_total,
            print_sides=item_payload.print_sides,
            requires_manual_duplex=bool(variant and variant.requires_manual_duplex and item_payload.pages_per_copy > 1),
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
    job_order.status_events.append(
        StatusEvent(from_status=None, to_status=job_order.status.value, note="Job order created.")
    )
    db.add(job_order)
    db.commit()
    db.refresh(job_order)
    return _to_read(job_order)


@router.post("/{job_order_id}/payments", response_model=JobOrderRead, status_code=201)
def record_payment(
    job_order_id: str,
    payload: PaymentCreate,
    db: Session = Depends(get_db),
) -> JobOrderRead:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    if job_order.status != JobOrderStatus.ready:
        raise HTTPException(status_code=409, detail="Payments can only be recorded while the job is in the Ready step.")
    verified_total = sum(payment.amount for payment in job_order.payments if payment.verified)
    outstanding = round(max(job_order.total - verified_total, 0), 2)
    if payload.amount > outstanding + 0.001:
        raise HTTPException(status_code=422, detail=f"Payment exceeds the outstanding balance of ₱{outstanding:,.2f}.")

    job_order.payments.append(Payment(amount=round(payload.amount, 2), method=payload.method, verified=True))
    if round(verified_total + payload.amount, 2) >= round(job_order.total, 2):
        _record_status(job_order, JobOrderStatus.paid, "Full payment recorded and verified by the owner.")
    db.commit()
    db.refresh(job_order)
    return _to_read(job_order)


@router.post("/{job_order_id}/transitions", response_model=JobOrderRead)
def transition_job_order(
    job_order_id: str,
    payload: JobOrderTransitionCreate,
    db: Session = Depends(get_db),
) -> JobOrderRead:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    target = JobOrderStatus(payload.to_status)
    operation_kind = job_order.items[0].operation_kind if job_order.items else None
    # Photocopy is produced entirely on the device with no computer queue to
    # return to. Scan does have a queue: the acquisition happens inside this
    # job, so a failed quality check can send it back to re-scan.
    if operation_kind == "photocopy" and target == JobOrderStatus.queued:
        raise HTTPException(status_code=409, detail="Photocopy jobs are produced on the device and cannot enter the computer print queue.")
    # Quality inspection is not its own status: printing lands in Ready, where
    # the owner either sends the job back to Queued for a re-print or, once
    # output passes, marks it Paid (collecting payment first if any balance
    # is outstanding). Ready -> Paid here only covers the no-balance case;
    # an outstanding balance must go through /payments instead.
    allowed: dict[JobOrderStatus, set[JobOrderStatus]] = {
        JobOrderStatus.printing: {JobOrderStatus.ready},
        JobOrderStatus.ready: {JobOrderStatus.queued, JobOrderStatus.paid},
        JobOrderStatus.paid: {JobOrderStatus.completed},
    }
    if target not in allowed.get(job_order.status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"{job_order.status.value.replace('_', ' ').title()} cannot move directly to {target.value.replace('_', ' ').title()}.",
        )
    if target == JobOrderStatus.paid:
        verified_total = sum(payment.amount for payment in job_order.payments if payment.verified)
        outstanding = round(max(job_order.total - verified_total, 0), 2)
        if outstanding > 0:
            raise HTTPException(
                status_code=422,
                detail=f"Record the outstanding balance of ₱{outstanding:,.2f} before marking this job paid.",
            )

    default_notes = {
        JobOrderStatus.ready: "Printing finished; owner started quality review.",
        JobOrderStatus.queued: f"Quality check did not pass; job requeued for a {'re-scan' if operation_kind == 'scan' else 're-print'}.",
        JobOrderStatus.paid: "No payment due; job marked paid without a payment record.",
        JobOrderStatus.completed: "Owner completed the job order.",
    }
    _record_status(job_order, target, payload.note.strip() if payload.note else default_notes[target])
    db.commit()
    db.refresh(job_order)
    return _to_read(job_order)


@router.post("/{job_order_id}/print-attempts", response_model=JobOrderRead, status_code=201)
async def submit_print_attempt(
    job_order_id: str,
    payload: PrintSubmissionCreate,
    db: Session = Depends(get_db),
) -> JobOrderRead:
    job_order = db.get(JobOrder, job_order_id)
    if not job_order:
        raise HTTPException(status_code=404, detail="Job order not found.")
    if job_order.workflow_category != "printing":
        raise HTTPException(status_code=409, detail="This workflow does not submit a document from the computer.")
    if job_order.status != JobOrderStatus.queued:
        raise HTTPException(status_code=409, detail="This job order is not in the print queue.")
    printer = db.get(Printer, payload.printer_id)
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found.")
    if printer.last_seen_state in {"offline", "error"}:
        raise HTTPException(status_code=409, detail=f"{printer.display_name} is currently {printer.last_seen_state}.")
    job_file = db.get(JobFile, payload.job_file_id)
    if not job_file or job_file.job_order_id != job_order.id or job_file.kind != "print_ready":
        raise HTTPException(status_code=404, detail="Print-ready job file not found.")
    copies, color_mode, media_size = _automatic_print_settings(job_order, job_file)
    item = job_order.items[0]
    manual_duplex = item.requires_manual_duplex and (job_file.detected_page_count or item.pages_per_copy) > 1
    if manual_duplex and settings.resolved_printer_platform != "windows":
        raise HTTPException(
            status_code=422,
            detail="Supervised back-to-back printing is currently available on the Windows printer host.",
        )
    successful_front = next(
        (
            attempt
            for attempt in sorted(job_order.print_jobs, key=lambda value: value.submitted_at, reverse=True)
            if attempt.result == PrintResult.succeeded and attempt.duplex_pass == "front"
        ),
        None,
    )
    expected_pass = "back" if manual_duplex and successful_front else "front" if manual_duplex else "simplex"
    duplex_pass = expected_pass if payload.duplex_pass == "auto" else payload.duplex_pass
    if duplex_pass != expected_pass:
        raise HTTPException(
            status_code=409,
            detail=(
                "Finish the front-side pass before printing the back sides."
                if expected_pass == "front"
                else "The front sides are complete. Reinsert the printed stack before submitting the back-side pass."
            ),
        )
    if duplex_pass == "back" and successful_front:
        if successful_front.printer_id != printer.id or successful_front.job_file_id != job_file.id:
            raise HTTPException(
                status_code=409,
                detail="Use the same printer and file as the completed front-side pass.",
            )
        # Both sides must use an identical physical profile to stay aligned.
        payload.orientation = successful_front.orientation
        payload.scaling = successful_front.scaling
        payload.quality = successful_front.quality
        payload.borderless = successful_front.borderless
        payload.collate = successful_front.collate

    files_root = (settings.resolved_data_dir / "files").resolve()
    stored_path = (settings.resolved_data_dir / job_file.stored_path).resolve()
    if files_root not in stored_path.parents or not stored_path.is_file():
        raise HTTPException(status_code=404, detail="The staged print file is unavailable.")
    pending_materials = _remaining_planned_materials(job_order)
    _validate_material_stock(pending_materials)
    owner = db.query(BusinessProfile).first()
    attempt = PrintJob(
        job_order_id=job_order.id,
        printer_id=printer.id,
        job_file_id=job_file.id,
        copies=copies,
        color_mode=color_mode,
        media_size=media_size,
        orientation=payload.orientation,
        scaling=payload.scaling,
        quality=payload.quality,
        borderless=payload.borderless,
        collate=payload.collate,
        duplex_pass=duplex_pass,
        result=PrintResult.pending,
        operator=owner.owner_name if owner else "Owner",
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    adapter = get_printer_adapter(settings.resolved_printer_platform)
    try:
        submission = await run_in_threadpool(
            adapter.submit_file,
            printer.system_name,
            stored_path,
            copies,
            color_mode,
            media_size,
            payload.orientation,
            payload.scaling,
            payload.quality,
            payload.borderless,
            payload.collate,
            attempt.id,
            duplex_pass,
        )
    except PrintSubmissionError as error:
        attempt.result = PrintResult.failed
        attempt.error_message = str(error)[:1000]
        db.commit()
        raise HTTPException(status_code=502, detail=f"Print submission failed: {error}") from error
    except Exception as error:
        attempt.result = PrintResult.failed
        attempt.error_message = "Unexpected operating-system print failure."
        db.commit()
        raise HTTPException(status_code=502, detail="The operating system could not submit the print job.") from error

    attempt.result = PrintResult.succeeded
    attempt.external_job_id = submission.external_job_id
    job_order.assigned_printer_id = printer.id
    if duplex_pass == "front":
        db.commit()
        db.refresh(job_order)
        return _to_read(job_order)
    movements = _deduct_planned_materials(
        job_order,
        pending_materials,
        db,
        note=f"Automatically deducted after printing {job_file.original_filename} for {job_order.number}",
    )
    material_note = (
        f" Automatically deducted {len(movements)} planned material {('entry' if len(movements) == 1 else 'entries')} from inventory."
        if movements
        else " Planned material usage was already fully recorded."
    )
    _record_status(
        job_order,
        JobOrderStatus.printing,
        f"Submitted {job_file.original_filename} to {printer.display_name}. "
        f"Document analysis selected {color_mode} output."
        f"{' Supervised front and back passes were submitted.' if duplex_pass == 'back' else ''}"
        f"{material_note}",
    )
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
    for entry in payload.entries:
        plan = plan_by_id[entry.material_plan_id]
        remaining = max(plan.planned_quantity - plan.consumed_quantity, 0.0)
        if entry.quantity_used > remaining:
            raise HTTPException(
                status_code=422,
                detail=f"Only {remaining:g} {plan.inventory_item.unit} remains in the plan for {plan.inventory_item.name}.",
            )

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


def _remaining_planned_materials(job_order: JobOrder) -> list[tuple[JobOrderMaterialPlan, float]]:
    remaining: list[tuple[JobOrderMaterialPlan, float]] = []
    for item in job_order.items:
        for plan in item.material_plans:
            quantity = max(plan.planned_quantity - plan.consumed_quantity, 0.0)
            if quantity > 1e-9:
                remaining.append((plan, quantity))
    return remaining


def _automatic_print_settings(job_order: JobOrder, job_file: JobFile) -> tuple[int, str, str]:
    if len(job_order.items) != 1:
        raise HTTPException(
            status_code=422,
            detail="Automatic print setup requires one analyzed product line for the selected file.",
        )
    item = job_order.items[0]
    copies = item.copies
    if copies > 99:
        raise HTTPException(
            status_code=422,
            detail="Automatic print submission supports up to 99 copies per job. Split this work into smaller jobs.",
        )
    # Product print type belongs to pricing/workflow. Physical output follows
    # the analyzed source: any detected color preserves RGB for the driver;
    # a confirmed monochrome document may be rendered as grayscale. Unknown
    # legacy analysis stays color-preserving to avoid irreversible data loss.
    color_mode = (
        "grayscale"
        if job_file.detected_color_pages == 0 and (job_file.detected_bw_pages or 0) > 0
        else "color"
    )
    configured_paper = next(
        (
            plan.inventory_item.paper_size.value
            for plan in item.material_plans
            if plan.inventory_item.paper_size is not None
        ),
        None,
    )
    detected_paper = job_file.detected_paper_size
    media_size = configured_paper or (
        detected_paper if detected_paper in {"A4", "Letter", "Legal"} else None
    )
    if media_size not in {"A4", "Letter", "Legal"}:
        raise HTTPException(
            status_code=422,
            detail="The analyzer could not match this file to an A4, Letter, or Legal material.",
        )
    return copies, color_mode, media_size


def _validate_material_stock(pending_materials: list[tuple[JobOrderMaterialPlan, float]]) -> None:
    requested_by_inventory: dict[str, float] = defaultdict(float)
    item_by_inventory = {}
    for plan, quantity in pending_materials:
        requested_by_inventory[plan.inventory_item_id] += quantity
        item_by_inventory[plan.inventory_item_id] = plan.inventory_item
    for inventory_item_id, requested_quantity in requested_by_inventory.items():
        inventory_item = item_by_inventory[inventory_item_id]
        if requested_quantity > inventory_item.quantity_on_hand:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Not enough {inventory_item.name} to print this job. "
                    f"Required {requested_quantity:g} {inventory_item.unit}; "
                    f"available {inventory_item.quantity_on_hand:g}. Restock it and try again."
                ),
            )


def _deduct_planned_materials(
    job_order: JobOrder,
    pending_materials: list[tuple[JobOrderMaterialPlan, float]],
    db: Session,
    note: str,
) -> list[InventoryMovement]:
    movements: list[InventoryMovement] = []
    for plan, quantity in pending_materials:
        inventory_item = plan.inventory_item
        balance_after = inventory_item.quantity_on_hand - quantity
        inventory_item.quantity_on_hand = balance_after
        plan.consumed_quantity += quantity
        movement = InventoryMovement(
            inventory_item_id=inventory_item.id,
            kind=InventoryMovementKind.job_usage,
            quantity_delta=-quantity,
            balance_after=balance_after,
            job_order_id=job_order.id,
            product_id=plan.job_order_item.product_id,
            note=note,
        )
        db.add(movement)
        movements.append(movement)
    return movements


def _next_job_order_number(db: Session) -> str:
    profile = db.query(BusinessProfile).first()
    prefix = (profile.job_order_prefix if profile else "JOB").strip() or "JOB"
    counter = db.get(JobOrderNumberSequence, 1)
    if counter is None:
        # Base.metadata.create_all() test/dev databases do not run Alembic's
        # seed insert, so bootstrap safely from the highest legacy suffix.
        highest = 0
        for (number,) in db.query(JobOrder.number).all():
            suffix = number.rsplit("-", 1)[-1]
            if suffix.isdigit():
                highest = max(highest, int(suffix))
        sequence = highest + 1
        db.add(JobOrderNumberSequence(id=1, next_value=sequence + 1))
        db.flush()
    else:
        # Atomic UPDATE ... RETURNING prevents two simultaneous job-creation
        # requests from receiving the same owner-facing reference.
        next_value = db.execute(
            update(JobOrderNumberSequence)
            .where(JobOrderNumberSequence.id == 1)
            .values(next_value=JobOrderNumberSequence.next_value + 1)
            .returning(JobOrderNumberSequence.next_value)
        ).scalar_one()
        sequence = next_value - 1
    return f"{prefix}-{sequence:010d}"


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
