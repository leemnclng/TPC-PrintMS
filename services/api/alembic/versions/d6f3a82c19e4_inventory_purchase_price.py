"""Add a current per-unit purchase price to inventory materials.

Revision ID: d6f3a82c19e4
Revises: c5d9a41e72b8
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6f3a82c19e4"
down_revision: str | None = "c5d9a41e72b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch_op:
        batch_op.add_column(sa.Column("purchase_price_per_unit", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "ck_inventory_items_purchase_price",
            "purchase_price_per_unit IS NULL OR purchase_price_per_unit >= 0",
        )


def downgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch_op:
        batch_op.drop_constraint("ck_inventory_items_purchase_price", type_="check")
        batch_op.drop_column("purchase_price_per_unit")
