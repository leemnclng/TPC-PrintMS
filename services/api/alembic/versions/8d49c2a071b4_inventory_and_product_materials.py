"""add inventory and product material recipes

Revision ID: 8d49c2a071b4
Revises: f210db8a914c
Create Date: 2026-08-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8d49c2a071b4"
down_revision: Union[str, None] = "f210db8a914c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("quantity_on_hand", sa.Float(), nullable=False),
        sa.Column("reorder_level", sa.Float(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "product_material_requirements",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=False),
        sa.Column("quantity_per_unit", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "inventory_item_id"),
    )
    op.create_index(
        "ix_product_material_requirements_product_id",
        "product_material_requirements",
        ["product_id"],
    )
    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("opening_balance", "stock_in", "stock_out", "adjustment", "job_usage", name="inventorymovementkind"),
            nullable=False,
        ),
        sa.Column("quantity_delta", sa.Float(), nullable=False),
        sa.Column("balance_after", sa.Float(), nullable=False),
        sa.Column("job_order_id", sa.String(), nullable=True),
        sa.Column("product_id", sa.String(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.ForeignKeyConstraint(["job_order_id"], ["job_orders.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inventory_movements_inventory_item_id", "inventory_movements", ["inventory_item_id"])
    op.create_index("ix_inventory_movements_job_order_id", "inventory_movements", ["job_order_id"])


def downgrade() -> None:
    op.drop_index("ix_inventory_movements_job_order_id", table_name="inventory_movements")
    op.drop_index("ix_inventory_movements_inventory_item_id", table_name="inventory_movements")
    op.drop_table("inventory_movements")
    op.drop_index(
        "ix_product_material_requirements_product_id",
        table_name="product_material_requirements",
    )
    op.drop_table("product_material_requirements")
    op.drop_table("inventory_items")
