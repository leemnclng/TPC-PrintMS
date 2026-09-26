"""Add structured print-failure ledger and reason catalog.

Revision ID: a1f7c9d2e640
Revises: f4c8d2a7019e
"""

from datetime import datetime
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision = "a1f7c9d2e640"
down_revision = "f4c8d2a7019e"
branch_labels = None
depends_on = None


REASONS = (
    ("streaks_banding", "Streaks / banding", "machine"),
    ("faded_low_toner", "Faded / low toner", "machine"),
    ("wrong_color", "Wrong color", "machine"),
    ("misalignment_skew", "Misalignment / skew", "machine"),
    ("wrong_paper_size", "Wrong paper / size", "operator"),
    ("paper_jam", "Paper jam", "machine"),
    ("smudge_wet_ink", "Smudge / wet ink", "material"),
    ("duplex_back_wrong", "Duplex back side wrong", "operator"),
    ("wrong_file_version", "Wrong file / version", "operator"),
    ("customer_changed_request", "Customer changed request", "customer"),
    ("printer_error", "Printer error", "machine"),
    ("submission_failed", "Print submission failed", "machine"),
    ("cancelled_mid_print", "Cancelled mid-print", "operator"),
    ("other", "Other", "operator"),
)


def upgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.add_column(sa.Column("spooler_failure_seen", sa.Boolean(), server_default=sa.false(), nullable=False))
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("spooler_failure_seen", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table(
        "failure_reasons",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("fault_type", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint("fault_type IN ('machine', 'material', 'operator', 'customer')", name="ck_failure_reasons_fault_type"),
        sa.PrimaryKeyConstraint("code"),
        sa.UniqueConstraint("label"),
    )
    op.create_table(
        "print_failures",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("job_order_id", sa.String(), nullable=True),
        sa.Column("job_order_item_id", sa.String(), nullable=True),
        sa.Column("print_job_id", sa.String(), nullable=True),
        sa.Column("observed_print_job_id", sa.String(), nullable=True),
        sa.Column("printer_name", sa.String(), nullable=True),
        sa.Column("reason_code", sa.String(), nullable=False),
        sa.Column("reason_note", sa.Text(), nullable=True),
        sa.Column("spoiled_sheets", sa.Integer(), nullable=True),
        sa.Column("material_cost_snapshot", sa.Float(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("source IN ('quality_rejected', 'spooler_error', 'submit_failed', 'cancelled_mid_print')", name="ck_print_failures_source"),
        sa.CheckConstraint("spoiled_sheets IS NULL OR spoiled_sheets >= 0", name="ck_print_failures_spoiled_sheets"),
        sa.CheckConstraint("material_cost_snapshot IS NULL OR material_cost_snapshot >= 0", name="ck_print_failures_material_cost"),
        sa.ForeignKeyConstraint(["job_order_id"], ["job_orders.id"]),
        sa.ForeignKeyConstraint(["job_order_item_id"], ["job_order_items.id"]),
        sa.ForeignKeyConstraint(["print_job_id"], ["print_jobs.id"]),
        sa.ForeignKeyConstraint(["observed_print_job_id"], ["observed_print_jobs.id"]),
        sa.ForeignKeyConstraint(["reason_code"], ["failure_reasons.code"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("source", "job_order_id", "job_order_item_id", "print_job_id", "observed_print_job_id", "occurred_at"):
        op.create_index(f"ix_print_failures_{column}", "print_failures", [column])

    connection = op.get_bind()
    now = datetime.utcnow()
    connection.execute(
        sa.text("INSERT INTO failure_reasons (code, label, fault_type, is_active, is_system, sort_order) VALUES (:code, :label, :fault_type, 1, :is_system, :sort_order)"),
        [
            {"code": code, "label": label, "fault_type": fault_type, "is_system": code in {"printer_error", "submission_failed", "cancelled_mid_print"}, "sort_order": order}
            for order, (code, label, fault_type) in enumerate(REASONS)
        ],
    )
    quality_events = connection.execute(sa.text(
        "SELECT e.job_order_item_id, i.job_order_id, e.note, e.occurred_at "
        "FROM job_order_item_status_events e JOIN job_order_items i ON i.id = e.job_order_item_id "
        "WHERE e.from_status = 'ready' AND e.to_status = 'queued'"
    )).mappings()
    for event in quality_events:
        note = event["note"] or None
        if note and "Quality failed:" in note:
            note = note.split("Quality failed:", 1)[1].strip() or None
        connection.execute(sa.text(
            "INSERT INTO print_failures (id, source, job_order_id, job_order_item_id, reason_code, reason_note, occurred_at, recorded_at) "
            "VALUES (:id, 'quality_rejected', :job_order_id, :job_order_item_id, 'other', :reason_note, :occurred_at, :recorded_at)"
        ), {"id": str(uuid4()), "job_order_id": event["job_order_id"], "job_order_item_id": event["job_order_item_id"], "reason_note": note, "occurred_at": event["occurred_at"], "recorded_at": now})
    failed_attempts = connection.execute(sa.text(
        "SELECT p.id, p.job_order_id, p.job_order_item_id, p.error_message, p.submitted_at, r.display_name "
        "FROM print_jobs p LEFT JOIN printers r ON r.id = p.printer_id WHERE p.result = 'failed'"
    )).mappings()
    for attempt in failed_attempts:
        connection.execute(sa.text(
            "INSERT INTO print_failures (id, source, job_order_id, job_order_item_id, print_job_id, printer_name, reason_code, reason_note, occurred_at, recorded_at) "
            "VALUES (:id, 'submit_failed', :job_order_id, :job_order_item_id, :print_job_id, :printer_name, 'submission_failed', :reason_note, :occurred_at, :recorded_at)"
        ), {"id": str(uuid4()), "job_order_id": attempt["job_order_id"], "job_order_item_id": attempt["job_order_item_id"], "print_job_id": attempt["id"], "printer_name": attempt["display_name"], "reason_note": attempt["error_message"], "occurred_at": attempt["submitted_at"], "recorded_at": now})


def downgrade() -> None:
    op.drop_table("print_failures")
    op.drop_table("failure_reasons")
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("spooler_failure_seen")
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_column("spooler_failure_seen")
