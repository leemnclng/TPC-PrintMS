"""Scope global paper pricing by production workflow.

Revision ID: d352af906b41
Revises: c2419a783f30
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "d352af906b41"
down_revision: str | None = "c2419a783f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.add_column(
            sa.Column("pricing_scope", sa.String(), server_default="printing", nullable=False)
        )
        batch_op.drop_constraint(
            "uq_document_pricing_rules_inventory_item_print_type", type_="unique"
        )
        batch_op.create_unique_constraint(
            "uq_document_pricing_rules_inventory_item_print_type_scope",
            ["inventory_item_id", "print_type", "pricing_scope"],
        )
        batch_op.create_check_constraint(
            "ck_document_pricing_rules_scope",
            "pricing_scope IN ('printing', 'photocopy')",
        )

    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)
    existing_rules = connection.execute(
        sa.text(
            "SELECT id, inventory_item_id, print_type, price_per_page, is_active "
            "FROM document_pricing_rules WHERE pricing_scope = 'printing'"
        )
    ).mappings().all()
    for rule in existing_rules:
        photocopy_rule_id = str(uuid4())
        connection.execute(
            sa.text(
                "INSERT INTO document_pricing_rules "
                "(id, inventory_item_id, print_type, pricing_scope, price_per_page, "
                "is_active, created_at, updated_at) "
                "VALUES (:id, :inventory_item_id, :print_type, 'photocopy', :price_per_page, "
                ":is_active, :created_at, :updated_at)"
            ),
            {
                "id": photocopy_rule_id,
                "inventory_item_id": rule["inventory_item_id"],
                "print_type": rule["print_type"],
                "price_per_page": rule["price_per_page"],
                "is_active": rule["is_active"],
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            sa.text(
                "UPDATE product_document_rates SET pricing_rule_id = :new_rule_id "
                "WHERE pricing_rule_id = :old_rule_id AND product_id IN "
                "(SELECT id FROM products WHERE operation_kind = 'photocopy')"
            ),
            {"new_rule_id": photocopy_rule_id, "old_rule_id": rule["id"]},
        )


def downgrade() -> None:
    connection = op.get_bind()
    photocopy_rules = connection.execute(
        sa.text(
            "SELECT id, inventory_item_id, print_type FROM document_pricing_rules "
            "WHERE pricing_scope = 'photocopy'"
        )
    ).mappings().all()
    for rule in photocopy_rules:
        printing_rule_id = connection.execute(
            sa.text(
                "SELECT id FROM document_pricing_rules WHERE inventory_item_id = :inventory_item_id "
                "AND print_type = :print_type AND pricing_scope = 'printing'"
            ),
            {
                "inventory_item_id": rule["inventory_item_id"],
                "print_type": rule["print_type"],
            },
        ).scalar_one()
        connection.execute(
            sa.text(
                "UPDATE product_document_rates SET pricing_rule_id = :printing_rule_id "
                "WHERE pricing_rule_id = :photocopy_rule_id"
            ),
            {
                "printing_rule_id": printing_rule_id,
                "photocopy_rule_id": rule["id"],
            },
        )
    connection.execute(
        sa.text("DELETE FROM document_pricing_rules WHERE pricing_scope = 'photocopy'")
    )

    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_document_pricing_rules_scope", type_="check")
        batch_op.drop_constraint(
            "uq_document_pricing_rules_inventory_item_print_type_scope", type_="unique"
        )
        batch_op.create_unique_constraint(
            "uq_document_pricing_rules_inventory_item_print_type",
            ["inventory_item_id", "print_type"],
        )
        batch_op.drop_column("pricing_scope")
