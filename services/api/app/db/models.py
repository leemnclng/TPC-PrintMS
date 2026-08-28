"""Core data model — see docs/context/build-plan.md § Core Data Model.

Status enums mirror the lifecycle strings in build-plan.md exactly (these are
the documented working draft; final transition permissions are still an open
question — see docs/context/issues-log.md).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class SourceChannel(str, enum.Enum):
    messenger = "messenger"
    gmail = "gmail"
    form = "form"
    walk_in = "walk_in"
    phone = "phone"
    other = "other"


class QuotationStatus(str, enum.Enum):
    draft = "draft"
    pending_approval = "pending_approval"
    approved = "approved"
    sent = "sent"
    accepted = "accepted"
    rejected = "rejected"
    expired = "expired"


class JobOrderStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    paid = "paid"
    queued = "queued"
    printing = "printing"
    quality_check = "quality_check"
    ready = "ready"
    released = "released"
    delivered = "delivered"
    completed = "completed"
    on_hold = "on_hold"
    cancelled = "cancelled"


class PrintSides(str, enum.Enum):
    single_sided = "single_sided"
    double_sided = "double_sided"


class ProductPrintType(str, enum.Enum):
    colored = "colored"
    black_and_white = "black_and_white"


class InventoryPaperSize(str, enum.Enum):
    """The only paper sizes the shop stocks and prices by. Deliberately a
    closed set — see decisions.md "Tie Document Pricing to Real Paper Stock"."""

    a4 = "A4"
    letter = "Letter"
    legal = "Legal"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    online = "online"
    bank_transfer = "bank_transfer"
    other = "other"


class PrintResult(str, enum.Enum):
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class InventoryMovementKind(str, enum.Enum):
    opening_balance = "opening_balance"
    stock_in = "stock_in"
    stock_out = "stock_out"
    adjustment = "adjustment"
    job_usage = "job_usage"


class AppUser(TimestampMixin, Base):
    """First supported role is owner/admin — see build-plan.md § Initial
    Release Assumptions. Roles/permissions beyond that are an open question."""

    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="owner", nullable=False)


class BusinessProfile(TimestampMixin, Base):
    """Singleton row — one printing workstation, one business profile."""

    __tablename__ = "business_profile"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    business_name: Mapped[str] = mapped_column(String, nullable=False)
    owner_name: Mapped[str] = mapped_column(String, default="Owner", nullable=False)
    tagline: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    quotation_prefix: Mapped[str] = mapped_column(String, default="QUO", nullable=False)
    job_order_prefix: Mapped[str] = mapped_column(String, default="JOB", nullable=False)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    source_channel: Mapped[SourceChannel] = mapped_column(
        Enum(SourceChannel), default=SourceChannel.other, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    quotations: Mapped[list["Quotation"]] = relationship(back_populates="customer")
    job_orders: Mapped[list["JobOrder"]] = relationship(back_populates="customer")


class Service(TimestampMixin, Base):
    __tablename__ = "services"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    products: Mapped[list["Product"]] = relationship(back_populates="service")


class Variant(TimestampMixin, Base):
    """Reusable production/pricing option available to every product."""

    __tablename__ = "variants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    label: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    product_variants: Mapped[list["ProductVariant"]] = relationship(back_populates="variant")


class DocumentPricingRule(TimestampMixin, Base):
    """Owner-configurable global per-page rate for one real paper-stock
    inventory item. Acts as the default a product's own rate falls back to
    — see `ProductDocumentRate`."""

    __tablename__ = "document_pricing_rules"
    __table_args__ = (UniqueConstraint("inventory_item_id", "print_type"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    inventory_item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)
    print_type: Mapped[ProductPrintType] = mapped_column(
        Enum(ProductPrintType, name="documentpricingprinttype", create_constraint=True),
        nullable=False,
    )
    price_per_page: Mapped[float] = mapped_column(Float, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    inventory_item: Mapped["InventoryItem"] = relationship(back_populates="document_pricing_rules")
    product_rates: Mapped[list["ProductDocumentRate"]] = relationship(back_populates="pricing_rule")

    @property
    def paper_size(self) -> InventoryPaperSize:
        return self.inventory_item.paper_size


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    print_type: Mapped[ProductPrintType] = mapped_column(
        Enum(ProductPrintType, name="productprinttype", create_constraint=True),
        default=ProductPrintType.black_and_white,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    service: Mapped["Service"] = relationship(back_populates="products")
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )
    material_assignments: Mapped[list["ProductMaterialAssignment"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )
    document_rates: Mapped[list["ProductDocumentRate"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )
    job_order_items: Mapped[list["JobOrderItem"]] = relationship(back_populates="product")


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (UniqueConstraint("product_id", "variant_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    variant_id: Mapped[str] = mapped_column(ForeignKey("variants.id"), nullable=False)
    price_adjustment: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="variants")
    variant: Mapped["Variant"] = relationship(back_populates="product_variants")

    @property
    def label(self) -> str:
        return self.variant.label


class ProductDocumentRate(Base):
    """Product-specific override of one global document-analyzer pricing
    rule. Missing combinations fall back to the rule's own global rate."""

    __tablename__ = "product_document_rates"
    __table_args__ = (UniqueConstraint("product_id", "pricing_rule_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    pricing_rule_id: Mapped[str] = mapped_column(ForeignKey("document_pricing_rules.id"), nullable=False)
    price_per_page: Mapped[float] = mapped_column(Float, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="document_rates")
    pricing_rule: Mapped["DocumentPricingRule"] = relationship(back_populates="product_rates")

    @property
    def paper_size(self) -> str:
        return self.pricing_rule.paper_size

    @property
    def print_type(self) -> ProductPrintType:
        return self.pricing_rule.print_type


class InventoryItem(TimestampMixin, Base):
    """Consumable stock used by day-to-day production."""

    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    quantity_on_hand: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    reorder_level: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    paper_size: Mapped[InventoryPaperSize | None] = mapped_column(
        Enum(
            InventoryPaperSize,
            name="inventorypapersize",
            create_constraint=True,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=True,
    )

    product_assignments: Mapped[list["ProductMaterialAssignment"]] = relationship(
        back_populates="inventory_item"
    )
    movements: Mapped[list["InventoryMovement"]] = relationship(
        back_populates="inventory_item", cascade="all, delete-orphan"
    )
    job_order_material_plans: Mapped[list["JobOrderMaterialPlan"]] = relationship(
        back_populates="inventory_item"
    )
    document_pricing_rules: Mapped[list["DocumentPricingRule"]] = relationship(
        back_populates="inventory_item"
    )


class ProductMaterialAssignment(Base):
    """Material that may be selected when fulfilling this product."""

    __tablename__ = "product_material_assignments"
    __table_args__ = (UniqueConstraint("product_id", "inventory_item_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    inventory_item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)

    product: Mapped["Product"] = relationship(back_populates="material_assignments")
    inventory_item: Mapped["InventoryItem"] = relationship(back_populates="product_assignments")


class Quotation(TimestampMixin, Base):
    __tablename__ = "quotations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    number: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), nullable=False)
    status: Mapped[QuotationStatus] = mapped_column(
        Enum(QuotationStatus), default=QuotationStatus.draft, nullable=False
    )
    source_channel: Mapped[SourceChannel] = mapped_column(
        Enum(SourceChannel), default=SourceChannel.other, nullable=False
    )

    customer: Mapped["Customer"] = relationship(back_populates="quotations")
    items: Mapped[list["QuotationItem"]] = relationship(
        back_populates="quotation", cascade="all, delete-orphan"
    )
    job_orders: Mapped[list["JobOrder"]] = relationship(back_populates="quotation")


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    quotation_id: Mapped[str] = mapped_column(ForeignKey("quotations.id"), nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    variant_label: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # AI may suggest line items; the owner must confirm before pricing is
    # final — see build-plan.md § Delivery Phases, Phase 3.
    ai_suggested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    quotation: Mapped["Quotation"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()


class JobOrder(TimestampMixin, Base):
    __tablename__ = "job_orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    number: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    quotation_id: Mapped[str | None] = mapped_column(ForeignKey("quotations.id"), nullable=True)
    status: Mapped[JobOrderStatus] = mapped_column(
        Enum(JobOrderStatus), default=JobOrderStatus.pending_payment, nullable=False
    )
    total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    suggested_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    price_overridden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_printer_id: Mapped[str | None] = mapped_column(ForeignKey("printers.id"), nullable=True)

    customer: Mapped["Customer | None"] = relationship(back_populates="job_orders")
    quotation: Mapped["Quotation | None"] = relationship(back_populates="job_orders")
    payments: Mapped[list["Payment"]] = relationship(back_populates="job_order", cascade="all, delete-orphan")
    files: Mapped[list["JobFile"]] = relationship(back_populates="job_order", cascade="all, delete-orphan")
    status_events: Mapped[list["StatusEvent"]] = relationship(
        back_populates="job_order", cascade="all, delete-orphan"
    )
    print_jobs: Mapped[list["PrintJob"]] = relationship(back_populates="job_order")
    inventory_movements: Mapped[list["InventoryMovement"]] = relationship(back_populates="job_order")
    items: Mapped[list["JobOrderItem"]] = relationship(
        back_populates="job_order", cascade="all, delete-orphan"
    )


class JobOrderItem(Base):
    __tablename__ = "job_order_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_id: Mapped[str] = mapped_column(ForeignKey("job_orders.id"), nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    variant_label: Mapped[str | None] = mapped_column(String, nullable=True)
    pages_per_copy: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    copies: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    line_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    print_sides: Mapped[PrintSides] = mapped_column(
        Enum(PrintSides), default=PrintSides.single_sided, nullable=False
    )

    job_order: Mapped["JobOrder"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship(back_populates="job_order_items")
    material_plans: Mapped[list["JobOrderMaterialPlan"]] = relationship(
        back_populates="job_order_item", cascade="all, delete-orphan"
    )


class JobOrderMaterialPlan(Base):
    __tablename__ = "job_order_material_plans"
    __table_args__ = (UniqueConstraint("job_order_item_id", "inventory_item_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_item_id: Mapped[str] = mapped_column(ForeignKey("job_order_items.id"), nullable=False)
    inventory_item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)
    planned_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    consumed_quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    job_order_item: Mapped["JobOrderItem"] = relationship(back_populates="material_plans")
    inventory_item: Mapped["InventoryItem"] = relationship(back_populates="job_order_material_plans")


class InventoryMovement(Base):
    """Immutable stock ledger; job usage rows provide per-order material audit."""

    __tablename__ = "inventory_movements"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    inventory_item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)
    kind: Mapped[InventoryMovementKind] = mapped_column(Enum(InventoryMovementKind), nullable=False)
    quantity_delta: Mapped[float] = mapped_column(Float, nullable=False)
    balance_after: Mapped[float] = mapped_column(Float, nullable=False)
    job_order_id: Mapped[str | None] = mapped_column(ForeignKey("job_orders.id"), nullable=True)
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    inventory_item: Mapped["InventoryItem"] = relationship(back_populates="movements")
    job_order: Mapped["JobOrder | None"] = relationship(back_populates="inventory_movements")
    product: Mapped["Product | None"] = relationship()


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_id: Mapped[str] = mapped_column(ForeignKey("job_orders.id"), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod), default=PaymentMethod.cash, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    job_order: Mapped["JobOrder"] = relationship(back_populates="payments")


class JobFile(Base):
    """Customer source files and approved print-ready files. Storage rules
    and supported formats are still open — see issues-log.md."""

    __tablename__ = "job_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_id: Mapped[str] = mapped_column(ForeignKey("job_orders.id"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    stored_path: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="source", nullable=False)  # source | print_ready
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detected_page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detected_paper_size: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_orientation: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_color_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detected_bw_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_color_coverage_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_ink_coverage_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_print_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    analysis_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    job_order: Mapped["JobOrder"] = relationship(back_populates="files")
    print_jobs: Mapped[list["PrintJob"]] = relationship(back_populates="job_file")


class Printer(Base):
    """Detected via the OS print-queue adapter, not hand-entered — see
    app/services/printing/adapter.py. Vendor-neutral by design."""

    __tablename__ = "printers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    system_name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_seen_state: Mapped[str] = mapped_column(String, default="unknown", nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    print_jobs: Mapped[list["PrintJob"]] = relationship(back_populates="printer")


class PrintJob(Base):
    __tablename__ = "print_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_id: Mapped[str] = mapped_column(ForeignKey("job_orders.id"), nullable=False)
    printer_id: Mapped[str] = mapped_column(ForeignKey("printers.id"), nullable=False)
    job_file_id: Mapped[str | None] = mapped_column(ForeignKey("job_files.id"), nullable=True)
    copies: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    color_mode: Mapped[str] = mapped_column(String, default="color", nullable=False)
    media_size: Mapped[str] = mapped_column(String, default="A4", nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    result: Mapped[PrintResult] = mapped_column(Enum(PrintResult), default=PrintResult.pending, nullable=False)
    operator: Mapped[str | None] = mapped_column(String, nullable=True)
    external_job_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    job_order: Mapped["JobOrder"] = relationship(back_populates="print_jobs")
    printer: Mapped["Printer"] = relationship(back_populates="print_jobs")
    job_file: Mapped["JobFile | None"] = relationship(back_populates="print_jobs")


class StatusEvent(Base):
    """Audit trail of job-order status transitions."""

    __tablename__ = "status_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    job_order_id: Mapped[str] = mapped_column(ForeignKey("job_orders.id"), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String, nullable=True)
    to_status: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    job_order: Mapped["JobOrder"] = relationship(back_populates="status_events")


class AuditEntry(Base):
    """General operator-action audit log, independent of job-order status
    history (covers settings changes, printer discovery runs, etc.)."""

    __tablename__ = "audit_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    actor: Mapped[str] = mapped_column(String, default="owner", nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
