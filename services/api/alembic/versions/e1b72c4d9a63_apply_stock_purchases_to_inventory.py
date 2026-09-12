"""apply stock purchases to inventory

Revision ID: e1b72c4d9a63
Revises: d6c41e8a2f70
"""

from alembic import op
import sqlalchemy as sa

revision = "e1b72c4d9a63"
down_revision = "d6c41e8a2f70"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_stock_purchases",
        sa.Column("sheets_per_ream", sa.Integer(), nullable=True),
    )
    op.add_column(
        "inventory_stock_purchases",
        sa.Column("applied_at", sa.DateTime(), nullable=True),
    )
    op.execute(
        """
        UPDATE inventory_stock_purchases
        SET sheets_per_ream = (
            SELECT inventory_items.sheets_per_ream
            FROM inventory_items
            WHERE inventory_items.id = inventory_stock_purchases.inventory_item_id
        )
        WHERE purchase_unit = 'ream'
        """
    )
    with op.batch_alter_table("inventory_movements") as batch_op:
        batch_op.add_column(sa.Column("stock_purchase_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_inventory_movements_stock_purchase_id",
            "inventory_stock_purchases",
            ["stock_purchase_id"],
            ["id"],
        )
        batch_op.create_unique_constraint(
            "uq_inventory_movements_stock_purchase_id",
            ["stock_purchase_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("inventory_movements") as batch_op:
        batch_op.drop_constraint("uq_inventory_movements_stock_purchase_id", type_="unique")
        batch_op.drop_constraint("fk_inventory_movements_stock_purchase_id", type_="foreignkey")
        batch_op.drop_column("stock_purchase_id")
    op.drop_column("inventory_stock_purchases", "applied_at")
    op.drop_column("inventory_stock_purchases", "sheets_per_ream")
