"""Add job order product lines and material plans.

Revision ID: c8d41e7ab523
Revises: b7a32f6c9e10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d41e7ab523"
down_revision: str | None = "b7a32f6c9e10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))

    op.create_table(
        "job_order_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_order_id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.Column("variant_label", sa.String(), nullable=True),
        sa.Column("pages_per_copy", sa.Integer(), nullable=False),
        sa.Column("copies", sa.Integer(), nullable=False),
        sa.Column("print_sides", sa.Enum("single_sided", "double_sided", name="printsides"), nullable=False),
        sa.ForeignKeyConstraint(["job_order_id"], ["job_orders.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_order_items_job_order_id", "job_order_items", ["job_order_id"])
    op.create_index("ix_job_order_items_product_id", "job_order_items", ["product_id"])

    op.create_table(
        "job_order_material_plans",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_order_item_id", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=False),
        sa.Column("planned_quantity", sa.Float(), nullable=False),
        sa.Column("consumed_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.ForeignKeyConstraint(["job_order_item_id"], ["job_order_items.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_order_item_id", "inventory_item_id"),
    )
    op.create_index(
        "ix_job_order_material_plans_job_order_item_id",
        "job_order_material_plans",
        ["job_order_item_id"],
    )
    op.create_index(
        "ix_job_order_material_plans_inventory_item_id",
        "job_order_material_plans",
        ["inventory_item_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_job_order_material_plans_inventory_item_id", table_name="job_order_material_plans")
    op.drop_index("ix_job_order_material_plans_job_order_item_id", table_name="job_order_material_plans")
    op.drop_table("job_order_material_plans")
    op.drop_index("ix_job_order_items_product_id", table_name="job_order_items")
    op.drop_index("ix_job_order_items_job_order_id", table_name="job_order_items")
    op.drop_table("job_order_items")
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.drop_column("notes")
