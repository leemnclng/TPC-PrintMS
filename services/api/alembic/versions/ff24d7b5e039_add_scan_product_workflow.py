"""Add scan products to the combined Scan or Photocopy workflow.

Revision ID: ff24d7b5e039
Revises: fe13c6a4d028
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ff24d7b5e039"
down_revision: str | None = "fe13c6a4d028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("operation_kind", sa.String(), server_default="printing", nullable=False))
        batch_op.add_column(sa.Column("standalone_price_per_page", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "ck_products_operation_kind",
            "operation_kind IN ('printing', 'photocopy', 'scan')",
        )
        batch_op.create_check_constraint(
            "ck_products_standalone_price",
            "standalone_price_per_page IS NULL OR standalone_price_per_page >= 0",
        )

    op.execute(
        sa.text(
            "UPDATE products SET operation_kind = 'photocopy' "
            "WHERE service_id IN (SELECT id FROM services WHERE category = 'photocopy')"
        )
    )
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.add_column(sa.Column("operation_kind", sa.String(), server_default="printing", nullable=False))
    op.execute(
        sa.text(
            "UPDATE job_order_items SET operation_kind = "
            "(SELECT products.operation_kind FROM products WHERE products.id = job_order_items.product_id)"
        )
    )
    op.execute(
        sa.text(
            "UPDATE services SET name = 'Scan or Photocopy', "
            "description = 'Device-side scanning and photocopy transactions.' "
            "WHERE lower(name) = 'photocopy' AND category = 'photocopy'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE services SET name = 'Photocopy', "
            "description = 'Device-side photocopy transactions recorded without a document upload.' "
            "WHERE name = 'Scan or Photocopy' AND category = 'photocopy'"
        )
    )
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.drop_column("operation_kind")
    with op.batch_alter_table("products") as batch_op:
        batch_op.drop_constraint("ck_products_standalone_price", type_="check")
        batch_op.drop_constraint("ck_products_operation_kind", type_="check")
        batch_op.drop_column("standalone_price_per_page")
        batch_op.drop_column("operation_kind")
