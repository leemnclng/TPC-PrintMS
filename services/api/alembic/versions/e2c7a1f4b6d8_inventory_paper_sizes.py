"""Tie document pricing rules to real inventory paper stock; drop product base price.

Revision ID: e2c7a1f4b6d8
Revises: d1b4a6f9c3e2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2c7a1f4b6d8"
down_revision: str | None = "d1b4a6f9c3e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PAPER_SIZE = sa.Enum("A4", "Letter", "Legal", name="inventorypapersize", create_constraint=True)
PRINT_TYPE = sa.Enum(
    "colored", "black_and_white", name="documentpricingprinttype", create_constraint=True
)


def upgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch_op:
        batch_op.add_column(sa.Column("paper_size", PAPER_SIZE, nullable=True))

    # The paper-size dimension moves from a free string to a real inventory
    # link, and no rule has ever been customized away from its seeded
    # default (and no product override exists yet) — rebuild both tables
    # clean rather than attempt an unrecoverable string -> FK mapping.
    op.execute("DELETE FROM product_document_rates")
    op.drop_table("document_pricing_rules")
    op.create_table(
        "document_pricing_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("inventory_item_id", sa.String(), nullable=False),
        sa.Column("print_type", PRINT_TYPE, nullable=False),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"],
            ["inventory_items.id"],
            name="fk_document_pricing_rules_inventory_item_id_inventory_items",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "inventory_item_id", "print_type", name="uq_document_pricing_rules_inventory_item_print_type"
        ),
    )

    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_column("base_price")


def downgrade() -> None:
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("base_price", sa.Float(), nullable=False, server_default="0"))

    op.execute("DELETE FROM product_document_rates")
    op.drop_table("document_pricing_rules")
    op.create_table(
        "document_pricing_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("paper_size", sa.String(), nullable=False),
        sa.Column("print_type", PRINT_TYPE, nullable=False),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("paper_size", "print_type"),
    )

    with op.batch_alter_table("inventory_items", recreate="always") as batch_op:
        batch_op.drop_constraint("inventorypapersize", type_="check")
        batch_op.drop_column("paper_size")
