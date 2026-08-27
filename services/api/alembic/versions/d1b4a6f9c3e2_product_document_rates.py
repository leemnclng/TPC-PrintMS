"""Add per-product overrides of document-analyzer pricing rules.

Revision ID: d1b4a6f9c3e2
Revises: c9d37a6105ef
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1b4a6f9c3e2"
down_revision: str | None = "c9d37a6105ef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_document_rates",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.Column("pricing_rule_id", sa.String(), nullable=False),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name="fk_product_document_rates_product_id_products"
        ),
        sa.ForeignKeyConstraint(
            ["pricing_rule_id"],
            ["document_pricing_rules.id"],
            name="fk_product_document_rates_pricing_rule_id_document_pricing_rules",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "product_id", "pricing_rule_id", name="uq_product_document_rates_product_pricing_rule"
        ),
    )


def downgrade() -> None:
    op.drop_table("product_document_rates")
