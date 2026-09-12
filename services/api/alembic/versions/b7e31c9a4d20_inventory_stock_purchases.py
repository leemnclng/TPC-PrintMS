"""add inventory stock purchase ledger

Revision ID: b7e31c9a4d20
Revises: ea7c4d91b250
"""

from alembic import op
import sqlalchemy as sa

revision = "b7e31c9a4d20"
down_revision = "ea7c4d91b250"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_stock_purchases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=True),
        sa.Column("material_name", sa.String(), nullable=False),
        sa.Column("purchase_unit", sa.String(), nullable=False),
        sa.Column("quantity_purchased", sa.Float(), nullable=False),
        sa.Column("total_cost", sa.Float(), nullable=False),
        sa.Column("supplier", sa.String(), nullable=True),
        sa.Column("reference", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("purchased_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity_purchased > 0", name="ck_stock_purchase_quantity"),
        sa.CheckConstraint("total_cost >= 0", name="ck_stock_purchase_total_cost"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("inventory_stock_purchases")
