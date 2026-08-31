"""Allow inventory purchase cost per unit or whole ream.

Revision ID: e7a4c91d26f8
Revises: d6f3a82c19e4
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7a4c91d26f8"
down_revision: str | None = "d6f3a82c19e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch_op:
        batch_op.drop_constraint("ck_inventory_items_purchase_price", type_="check")
        batch_op.alter_column(
            "purchase_price_per_unit",
            new_column_name="purchase_price",
            existing_type=sa.Float(),
            existing_nullable=True,
        )
        batch_op.add_column(
            sa.Column("purchase_price_basis", sa.String(), nullable=False, server_default="unit")
        )
        batch_op.add_column(sa.Column("sheets_per_ream", sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            "ck_inventory_items_purchase_price",
            "purchase_price IS NULL OR purchase_price >= 0",
        )
        batch_op.create_check_constraint(
            "ck_inventory_items_purchase_basis",
            "purchase_price_basis IN ('unit', 'ream')",
        )
        batch_op.create_check_constraint(
            "ck_inventory_items_ream_size",
            "(purchase_price_basis = 'unit' AND sheets_per_ream IS NULL) OR "
            "(purchase_price_basis = 'ream' AND sheets_per_ream > 0)",
        )


def downgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch_op:
        batch_op.drop_constraint("ck_inventory_items_ream_size", type_="check")
        batch_op.drop_constraint("ck_inventory_items_purchase_basis", type_="check")
        batch_op.drop_constraint("ck_inventory_items_purchase_price", type_="check")
        batch_op.drop_column("sheets_per_ream")
        batch_op.drop_column("purchase_price_basis")
        batch_op.alter_column(
            "purchase_price",
            new_column_name="purchase_price_per_unit",
            existing_type=sa.Float(),
            existing_nullable=True,
        )
        batch_op.create_check_constraint(
            "ck_inventory_items_purchase_price",
            "purchase_price_per_unit IS NULL OR purchase_price_per_unit >= 0",
        )
