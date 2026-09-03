"""Add the externally completed Ad Hoc product operation.

Revision ID: e5b2d9c8f031
Revises: e4a1c8b7d920
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5b2d9c8f031"
down_revision: str | None = "e4a1c8b7d920"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("pricing_categories", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_pricing_categories_operation_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_pricing_categories_operation_kind",
            "operation_kind IN ('printing', 'photocopy', 'adhoc')",
        )
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_products_operation_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_products_operation_kind",
            "operation_kind IN ('printing', 'photocopy', 'scan', 'adhoc')",
        )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE job_order_items SET operation_kind = 'printing' "
        "WHERE operation_kind = 'adhoc'")
    )
    connection.execute(
        sa.text("UPDATE products SET operation_kind = 'printing', pricing_category_key = 'printing' "
        "WHERE operation_kind = 'adhoc'")
    )
    connection.execute(
        sa.text("DELETE FROM product_document_rates WHERE pricing_rule_id IN "
        "(SELECT id FROM document_pricing_rules WHERE pricing_scope IN "
        "(SELECT key FROM pricing_categories WHERE operation_kind = 'adhoc'))")
    )
    connection.execute(
        sa.text("DELETE FROM document_pricing_rules WHERE pricing_scope IN "
        "(SELECT key FROM pricing_categories WHERE operation_kind = 'adhoc')")
    )
    connection.execute(
        sa.text("DELETE FROM pricing_category_materials WHERE pricing_category_key IN "
        "(SELECT key FROM pricing_categories WHERE operation_kind = 'adhoc')")
    )
    connection.execute(sa.text("DELETE FROM pricing_categories WHERE operation_kind = 'adhoc'"))
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_products_operation_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_products_operation_kind",
            "operation_kind IN ('printing', 'photocopy', 'scan')",
        )
    with op.batch_alter_table("pricing_categories", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_pricing_categories_operation_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_pricing_categories_operation_kind",
            "operation_kind IN ('printing', 'photocopy')",
        )
