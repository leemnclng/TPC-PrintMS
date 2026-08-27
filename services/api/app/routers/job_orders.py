from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import require_token
from ..db.models import (
    BusinessProfile,
    Customer,
    InventoryMovement,
    InventoryMovementKind,
    JobOrder,
    JobOrderItem,
    JobOrderMaterialPlan,
    Product,
)
from ..db.session import get_db
from ..schemas.inventory import InventoryMovementRead
from ..schemas.job_orders import JobOrderCreate, JobOrderMaterialUsageCreate, JobOrderRead
from ..services.product_pricing import price_per_page_for_material, reference_price_per_page

router = APIRouter(prefix="/job-orders", tags=["job-orders"], dependencies=[Depends(require_token)])


def _to_read(job_order: JobOrder) -> JobOrderRead:
    return JobOrderRead(
        id=job_order.id,
        number=job_order.number,
        customer_id=job_order.customer_id,
        customer_name=job_order.customer.display_name if job_order.customer else None,
        quotation_id=job_order.quotation_id,
        status=job_order.status,
        total=job_order.total,
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
