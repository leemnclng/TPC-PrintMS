from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..core.security import require_token
from ..db.models import (
    InventoryItem,
    InventoryMovement,
    InventoryMovementKind,
    InventoryStockPurchase,
    JobOrder,
    Product,
)
from ..db.session import get_db
from ..schemas.inventory import (
    InventoryAdjustmentCreate,
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    InventoryMovementRead,
    InventoryStockPurchaseCreate,
    InventoryStockPurchaseRead,
    PaperSizeDefinitionRead,
)
from ..services.paper_sizes import (
    PAPER_SIZE_DEFINITIONS,
    canonical_paper_dimensions,
)

router = APIRouter(tags=["inventory"], dependencies=[Depends(require_token)])

INVENTORY_UNITS = {"sheet", "ream", "bottle", "cartridge", "roll", "pack", "piece"}


def _item_to_read(item: InventoryItem) -> InventoryItemRead:
    return InventoryItemRead(
        id=item.id,
        name=item.name,
        category=item.category,
        unit=item.unit,
        quantity_on_hand=item.quantity_on_hand,
        reorder_level=item.reorder_level,
        purchase_price=item.purchase_price,
        purchase_price_basis=item.purchase_price_basis,
        sheets_per_ream=item.sheets_per_ream,
        notes=item.notes,
        is_active=item.is_active,
        paper_size=item.paper_size,
        paper_width_mm=item.paper_width_mm,
        paper_height_mm=item.paper_height_mm,
        linked_product_count=len(item.product_assignments),
        stock_purchase_count=len(item.stock_purchases),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _movement_to_read(movement: InventoryMovement) -> InventoryMovementRead:
    return InventoryMovementRead(
        job_order_name=movement.job_order.name if movement.job_order else None,
        job_order_number=movement.job_order.number if movement.job_order else None,
        job_order_status=movement.job_order.status.value if movement.job_order else None,
        product_name=movement.product.name if movement.product else None,
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


def _purchase_to_read(purchase: InventoryStockPurchase) -> InventoryStockPurchaseRead:
    return InventoryStockPurchaseRead(
        id=purchase.id,
        inventory_item_id=purchase.inventory_item_id,
        material_name=purchase.material_name,
        purchase_unit=purchase.purchase_unit,
        quantity_purchased=purchase.quantity_purchased,
        total_cost=purchase.total_cost,
        unit_cost=round(purchase.total_cost / purchase.quantity_purchased, 6),
        supplier=purchase.supplier,
        reference=purchase.reference,
        notes=purchase.notes,
        purchased_on=purchase.purchased_on,
        created_at=purchase.created_at,
    )


def _clean_item_data(data: dict) -> dict:
    data["name"] = data["name"].strip()
    data["category"] = data["category"].strip()
    data["unit"] = data["unit"].strip().lower()
    data["notes"] = data["notes"].strip() if data.get("notes") else None
    if not data["name"] or not data["category"] or not data["unit"]:
        raise HTTPException(status_code=422, detail="Name, category, and unit are required.")
    if data["unit"] not in INVENTORY_UNITS:
        raise HTTPException(
            status_code=422,
            detail="Unit must be Sheet, Ream, Bottle, Cartridge, Roll, Pack, or Piece.",
        )
    paper_size = data.get("paper_size")
    if paper_size is None:
        data["paper_width_mm"] = None
        data["paper_height_mm"] = None
    else:
        try:
            width_mm, height_mm = canonical_paper_dimensions(
                paper_size,
                data.get("paper_width_mm"),
                data.get("paper_height_mm"),
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        data["paper_width_mm"] = width_mm
        data["paper_height_mm"] = height_mm
    return data


def _ensure_unique_name(name: str, db: Session, exclude_id: str | None = None) -> None:
    query = db.query(InventoryItem).filter(func.lower(InventoryItem.name) == name.lower())
    if exclude_id:
        query = query.filter(InventoryItem.id != exclude_id)
    if query.first():
        raise HTTPException(status_code=409, detail="An inventory item with this name already exists.")


@router.get("/paper-sizes", response_model=list[PaperSizeDefinitionRead])
def list_paper_sizes() -> list[PaperSizeDefinitionRead]:
    return [
        PaperSizeDefinitionRead(
            key=definition.key,
            label=definition.label,
            width_mm=definition.width_mm,
            height_mm=definition.height_mm,
            group=definition.group,
        )
        for definition in PAPER_SIZE_DEFINITIONS
    ]


@router.get("/inventory-items", response_model=list[InventoryItemRead])
def list_inventory_items(db: Session = Depends(get_db)) -> list[InventoryItemRead]:
    items = db.query(InventoryItem).order_by(InventoryItem.category, InventoryItem.name).all()
    return [_item_to_read(item) for item in items]


@router.get("/inventory-stock-purchases", response_model=list[InventoryStockPurchaseRead])
def list_inventory_stock_purchases(
    inventory_item_id: str | None = None,
    db: Session = Depends(get_db),
) -> list[InventoryStockPurchaseRead]:
    query = db.query(InventoryStockPurchase)
    if inventory_item_id:
        query = query.filter(InventoryStockPurchase.inventory_item_id == inventory_item_id)
    purchases = query.order_by(
        InventoryStockPurchase.purchased_on.desc(),
        InventoryStockPurchase.created_at.desc(),
    ).all()
    return [_purchase_to_read(purchase) for purchase in purchases]


@router.post("/inventory-stock-purchases", response_model=InventoryStockPurchaseRead, status_code=201)
def create_inventory_stock_purchase(
    payload: InventoryStockPurchaseCreate,
    db: Session = Depends(get_db),
) -> InventoryStockPurchaseRead:
    item = db.get(InventoryItem, payload.inventory_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    if not item.is_active:
        raise HTTPException(status_code=409, detail="Reactivate this material before recording a stock purchase.")
    if payload.purchased_on > date.today():
        raise HTTPException(status_code=422, detail="Purchase date cannot be in the future.")
    if abs(payload.quantity_purchased * 1_000_000 - round(payload.quantity_purchased * 1_000_000)) > 0.000001:
        raise HTTPException(status_code=422, detail="Quantity supports up to six decimal places.")
    if abs(payload.total_cost * 100 - round(payload.total_cost * 100)) > 0.000001:
        raise HTTPException(status_code=422, detail="Total cost supports up to two decimal places.")

    quantity = round(payload.quantity_purchased, 6)
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be at least 0.000001.")
    total_cost = round(payload.total_cost, 2)
    purchase_unit = "ream" if item.purchase_price_basis == "ream" else item.unit
    purchase = InventoryStockPurchase(
        inventory_item_id=item.id,
        material_name=item.name,
        purchase_unit=purchase_unit,
        quantity_purchased=quantity,
        total_cost=total_cost,
        supplier=payload.supplier.strip() if payload.supplier and payload.supplier.strip() else None,
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        purchased_on=payload.purchased_on,
    )
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return _purchase_to_read(purchase)


@router.post("/inventory-items", response_model=InventoryItemRead, status_code=201)
def create_inventory_item(payload: InventoryItemCreate, db: Session = Depends(get_db)) -> InventoryItemRead:
    data = _clean_item_data(payload.model_dump())
    opening_quantity = data.pop("opening_quantity")
    _ensure_unique_name(data["name"], db)

    item = InventoryItem(**data, quantity_on_hand=opening_quantity)
    db.add(item)
    db.flush()
    if opening_quantity > 0:
        db.add(
            InventoryMovement(
                inventory_item_id=item.id,
                kind=InventoryMovementKind.opening_balance,
                quantity_delta=opening_quantity,
                balance_after=opening_quantity,
                note="Opening balance",
            )
        )
    db.commit()
    db.refresh(item)
    return _item_to_read(item)


@router.get("/inventory-items/{item_id}", response_model=InventoryItemRead)
def get_inventory_item(item_id: str, db: Session = Depends(get_db)) -> InventoryItemRead:
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    return _item_to_read(item)


@router.put("/inventory-items/{item_id}", response_model=InventoryItemRead)
def update_inventory_item(
    item_id: str, payload: InventoryItemUpdate, db: Session = Depends(get_db)
) -> InventoryItemRead:
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    data = _clean_item_data(payload.model_dump())
    _ensure_unique_name(data["name"], db, exclude_id=item_id)
    for field, value in data.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return _item_to_read(item)


@router.delete("/inventory-items/{item_id}", status_code=204)
def delete_inventory_item(item_id: str, db: Session = Depends(get_db)) -> None:
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    if item.product_assignments:
        raise HTTPException(
            status_code=409,
            detail="Remove this material from its linked products before deleting it.",
        )
    if item.job_order_material_plans or item.document_pricing_rules:
        raise HTTPException(
            status_code=409,
            detail="This material is used in a job order or document-analyzer pricing and can't be deleted. Deactivate it instead.",
        )
    # Purchase spending remains as a material-name/unit snapshot even after
    # the operational material is removed.
    db.query(InventoryStockPurchase).filter(
        InventoryStockPurchase.inventory_item_id == item.id
    ).update({InventoryStockPurchase.inventory_item_id: None}, synchronize_session=False)
    # Movement history alone no longer blocks deletion — the item's own
    # stock-movement log is deleted with it (cascade). What still blocks
    # deletion is anything with its own independent record referencing this
    # item (a product, a job order, a pricing rule).
    db.delete(item)
    db.commit()


@router.post("/inventory-items/{item_id}/adjustments", response_model=InventoryMovementRead, status_code=201)
def adjust_inventory_item(
    item_id: str, payload: InventoryAdjustmentCreate, db: Session = Depends(get_db)
) -> InventoryMovementRead:
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    if payload.quantity_delta == 0:
        raise HTTPException(status_code=422, detail="Stock adjustment must be greater or less than zero.")
    if payload.kind == InventoryMovementKind.opening_balance:
        raise HTTPException(status_code=422, detail="Opening balances can only be recorded when creating an item.")
    if payload.kind == InventoryMovementKind.stock_in and payload.quantity_delta < 0:
        raise HTTPException(status_code=422, detail="Stock received must increase the balance.")
    if payload.kind in {InventoryMovementKind.stock_out, InventoryMovementKind.job_usage} and payload.quantity_delta > 0:
        raise HTTPException(status_code=422, detail="Stock used must decrease the balance.")
    if payload.kind == InventoryMovementKind.job_usage and not payload.job_order_id:
        raise HTTPException(status_code=422, detail="Job usage requires a job order.")
    if payload.job_order_id and not db.get(JobOrder, payload.job_order_id):
        raise HTTPException(status_code=404, detail="Job order not found.")
    if payload.product_id and not db.get(Product, payload.product_id):
        raise HTTPException(status_code=404, detail="Product not found.")

    balance_after = item.quantity_on_hand + payload.quantity_delta
    if balance_after < 0:
        raise HTTPException(status_code=409, detail="This adjustment would make the stock balance negative.")

    item.quantity_on_hand = balance_after
    movement = InventoryMovement(
        inventory_item_id=item.id,
        kind=payload.kind,
        quantity_delta=payload.quantity_delta,
        balance_after=balance_after,
        job_order_id=payload.job_order_id,
        product_id=payload.product_id,
        note=payload.note.strip() if payload.note else None,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return _movement_to_read(movement)


@router.get("/inventory-movements", response_model=list[InventoryMovementRead])
def list_inventory_movements(
    inventory_item_id: str | None = None,
    job_order_id: str | None = None,
    db: Session = Depends(get_db),
) -> list[InventoryMovementRead]:
    query = db.query(InventoryMovement).options(
        joinedload(InventoryMovement.inventory_item),
        joinedload(InventoryMovement.job_order),
        joinedload(InventoryMovement.product),
    )
    if inventory_item_id:
        query = query.filter(InventoryMovement.inventory_item_id == inventory_item_id)
    if job_order_id:
        query = query.filter(InventoryMovement.job_order_id == job_order_id)
    movements = query.order_by(InventoryMovement.occurred_at.desc()).all()
    return [_movement_to_read(movement) for movement in movements]
