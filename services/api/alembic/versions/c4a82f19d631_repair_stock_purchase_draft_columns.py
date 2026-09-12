"""repair stock purchase columns from the development draft

Revision ID: c4a82f19d631
Revises: b7e31c9a4d20
"""

from alembic import op
import sqlalchemy as sa

revision = "c4a82f19d631"
down_revision = "b7e31c9a4d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Bring databases that ran the earlier draft migration to the final schema."""
    inspector = sa.inspect(op.get_bind())
    if "inventory_stock_purchases" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("inventory_stock_purchases")}
    with op.batch_alter_table("inventory_stock_purchases") as batch_op:
        if "material_unit" in columns and "purchase_unit" not in columns:
            batch_op.alter_column(
                "material_unit",
                existing_type=sa.String(),
                new_column_name="purchase_unit",
            )
        if "quantity_received" in columns and "quantity_purchased" not in columns:
            batch_op.drop_constraint("ck_stock_purchase_quantity", type_="check")
            batch_op.alter_column(
                "quantity_received",
                existing_type=sa.Float(),
                new_column_name="quantity_purchased",
            )
            batch_op.create_check_constraint(
                "ck_stock_purchase_quantity",
                "quantity_purchased > 0",
            )


def downgrade() -> None:
    # The parent migration already represents the finalized column names.
    pass
