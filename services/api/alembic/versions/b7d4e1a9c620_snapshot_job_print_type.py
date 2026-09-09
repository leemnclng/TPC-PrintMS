"""Snapshot print type on job product lines.

Revision ID: b7d4e1a9c620
Revises: a6c3e9f1b742
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d4e1a9c620"
down_revision: str | None = "a6c3e9f1b742"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.add_column(sa.Column("print_type_snapshot", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("print_type_label_snapshot", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("print_color_mode_snapshot", sa.String(), nullable=True))
    op.execute(sa.text("""
        UPDATE job_order_items
        SET print_type_snapshot = (SELECT products.print_type FROM products WHERE products.id = job_order_items.product_id),
            print_type_label_snapshot = (
                SELECT print_types.label
                FROM products
                JOIN print_types ON print_types.key = products.print_type
                WHERE products.id = job_order_items.product_id
            ),
            print_color_mode_snapshot = (
                SELECT print_types.color_mode
                FROM products
                JOIN print_types ON print_types.key = products.print_type
                WHERE products.id = job_order_items.product_id
            )
    """))


def downgrade() -> None:
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.drop_column("print_color_mode_snapshot")
        batch_op.drop_column("print_type_label_snapshot")
        batch_op.drop_column("print_type_snapshot")
