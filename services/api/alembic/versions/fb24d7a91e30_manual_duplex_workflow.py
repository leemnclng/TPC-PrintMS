"""Add supervised manual-duplex production state.

Revision ID: fb24d7a91e30
Revises: fa13c5d8e902
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fb24d7a91e30"
down_revision: str | None = "fa13c5d8e902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("variants") as batch_op:
        batch_op.add_column(
            sa.Column("requires_manual_duplex", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.add_column(
            sa.Column("requires_manual_duplex", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(
            sa.Column("duplex_pass", sa.String(), server_default="simplex", nullable=False)
        )

    # Preserve the established Back-to-back catalog behavior and historical
    # job snapshots without relying on label matching at runtime.
    op.execute(
        sa.text(
            "UPDATE variants SET requires_manual_duplex = 1 "
            "WHERE lower(replace(replace(label, '-', ''), ' ', '')) IN "
            "('backtoback', 'doublesided', 'manualduplex')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE job_order_items SET requires_manual_duplex = 1 "
            "WHERE lower(replace(replace(coalesce(variant_label, ''), '-', ''), ' ', '')) IN "
            "('backtoback', 'doublesided', 'manualduplex')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE job_order_material_plans SET planned_quantity = ("
            "SELECT CAST((job_order_items.pages_per_copy + 1) / 2 AS INTEGER) * job_order_items.copies "
            "FROM job_order_items WHERE job_order_items.id = job_order_material_plans.job_order_item_id"
            ") WHERE consumed_quantity = 0 AND EXISTS ("
            "SELECT 1 FROM job_order_items JOIN inventory_items "
            "ON inventory_items.id = job_order_material_plans.inventory_item_id "
            "WHERE job_order_items.id = job_order_material_plans.job_order_item_id "
            "AND job_order_items.requires_manual_duplex = 1 "
            "AND inventory_items.paper_size IS NOT NULL "
            "AND lower(inventory_items.unit) LIKE '%sheet%'"
            ")"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("duplex_pass")
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.drop_column("requires_manual_duplex")
    with op.batch_alter_table("variants") as batch_op:
        batch_op.drop_column("requires_manual_duplex")
