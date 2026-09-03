"""Add owner-managed pricing categories and explicit paper assignments.

Revision ID: e4a1c8b7d920
Revises: c3f8a02d94b1
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "e4a1c8b7d920"
down_revision: str | None = "c3f8a02d94b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pricing_categories",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("operation_kind", sa.String(), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "operation_kind IN ('printing', 'photocopy')",
            name="ck_pricing_categories_operation_kind",
        ),
        sa.PrimaryKeyConstraint("key"),
        sa.UniqueConstraint("name"),
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    categories = sa.table(
        "pricing_categories",
        sa.column("key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("operation_kind", sa.String()),
        sa.column("is_builtin", sa.Boolean()),
        sa.column("is_active", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(categories, [
        {
            "key": "printing",
            "name": "Printing",
            "description": "File-based output sent to a printer.",
            "operation_kind": "printing",
            "is_builtin": True,
            "is_active": True,
            "sort_order": 0,
            "created_at": now,
            "updated_at": now,
        },
        {
            "key": "photocopy",
            "name": "Scan or Photocopy",
            "description": "Device-side photocopy output. Scan-to-softcopy uses scan tiers.",
            "operation_kind": "photocopy",
            "is_builtin": True,
            "is_active": True,
            "sort_order": 1,
            "created_at": now,
            "updated_at": now,
        },
    ])

    op.create_table(
        "pricing_category_materials",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("pricing_category_key", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["pricing_category_key"], ["pricing_categories.key"]),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pricing_category_key", "inventory_item_id"),
    )
    connection = op.get_bind()
    assignments = connection.execute(sa.text(
        "SELECT DISTINCT pricing_scope, inventory_item_id FROM document_pricing_rules"
    )).mappings().all()
    for assignment in assignments:
        connection.execute(sa.text(
            "INSERT INTO pricing_category_materials "
            "(id, pricing_category_key, inventory_item_id) VALUES (:id, :category, :material)"
        ), {
            "id": str(uuid4()),
            "category": assignment["pricing_scope"],
            "material": assignment["inventory_item_id"],
        })

    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("pricing_category_key", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_products_pricing_category_key_pricing_categories",
            "pricing_categories",
            ["pricing_category_key"],
            ["key"],
        )
    connection.execute(sa.text(
        "UPDATE products SET pricing_category_key = operation_kind "
        "WHERE operation_kind IN ('printing', 'photocopy')"
    ))

    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_document_pricing_rules_scope", type_="check")
        batch_op.create_foreign_key(
            "fk_document_pricing_rules_scope_pricing_categories",
            "pricing_categories",
            ["pricing_scope"],
            ["key"],
        )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text(
        "DELETE FROM product_document_rates WHERE pricing_rule_id IN "
        "(SELECT id FROM document_pricing_rules WHERE pricing_scope NOT IN ('printing', 'photocopy'))"
    ))
    connection.execute(sa.text(
        "DELETE FROM document_pricing_rules WHERE pricing_scope NOT IN ('printing', 'photocopy')"
    ))
    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.drop_constraint(
            "fk_document_pricing_rules_scope_pricing_categories", type_="foreignkey"
        )
        batch_op.create_check_constraint(
            "ck_document_pricing_rules_scope",
            "pricing_scope IN ('printing', 'photocopy')",
        )
    with op.batch_alter_table("products") as batch_op:
        batch_op.drop_constraint(
            "fk_products_pricing_category_key_pricing_categories", type_="foreignkey"
        )
        batch_op.drop_column("pricing_category_key")
    op.drop_table("pricing_category_materials")
    op.drop_table("pricing_categories")
