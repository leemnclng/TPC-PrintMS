"""Add per-item workflow state and production ownership.

Revision ID: a130d8e4c912
Revises: ff24d7b5e039
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a130d8e4c912"
down_revision: str | None = "ff24d7b5e039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.add_column(sa.Column("status", sa.String(), server_default="queued", nullable=False))
    op.execute(sa.text(
        "UPDATE job_order_items SET status = CASE "
        "WHEN (SELECT status FROM job_orders WHERE job_orders.id = job_order_items.job_order_id) "
        "IN ('ready', 'paid', 'completed', 'released', 'delivered') THEN 'ready' "
        "WHEN (SELECT status FROM job_orders WHERE job_orders.id = job_order_items.job_order_id) = 'printing' THEN 'printing' "
        "ELSE 'queued' END"
    ))

    with op.batch_alter_table("job_files") as batch_op:
        batch_op.add_column(sa.Column("job_order_item_id", sa.String(), nullable=True))
        batch_op.create_foreign_key("fk_job_files_item", "job_order_items", ["job_order_item_id"], ["id"])
    op.execute(sa.text(
        "UPDATE job_files SET job_order_item_id = "
        "(SELECT id FROM job_order_items WHERE job_order_items.job_order_id = job_files.job_order_id ORDER BY id LIMIT 1)"
    ))

    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("job_order_item_id", sa.String(), nullable=True))
        batch_op.create_foreign_key("fk_print_jobs_item", "job_order_items", ["job_order_item_id"], ["id"])
    op.execute(sa.text(
        "UPDATE print_jobs SET job_order_item_id = "
        "(SELECT id FROM job_order_items WHERE job_order_items.job_order_id = print_jobs.job_order_id ORDER BY id LIMIT 1)"
    ))

    op.create_table(
        "job_order_item_status_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("job_order_item_id", sa.String(), sa.ForeignKey("job_order_items.id"), nullable=False),
        sa.Column("from_status", sa.String(), nullable=True),
        sa.Column("to_status", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_item_status_events_item", "job_order_item_status_events", ["job_order_item_id"])


def downgrade() -> None:
    op.drop_index("ix_item_status_events_item", table_name="job_order_item_status_events")
    op.drop_table("job_order_item_status_events")
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_constraint("fk_print_jobs_item", type_="foreignkey")
        batch_op.drop_column("job_order_item_id")
    with op.batch_alter_table("job_files") as batch_op:
        batch_op.drop_constraint("fk_job_files_item", type_="foreignkey")
        batch_op.drop_column("job_order_item_id")
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.drop_column("status")
