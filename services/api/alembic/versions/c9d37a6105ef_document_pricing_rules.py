"""Add configurable document-analyzer pricing rules.

Revision ID: c9d37a6105ef
Revises: b8e26f4c9120
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "c9d37a6105ef"
down_revision: str | None = "b8e26f4c9120"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_RATES = {
    "A3": {"black_and_white": 4.0, "colored": 10.0},
    "A4": {"black_and_white": 2.0, "colored": 5.0},
    "Letter": {"black_and_white": 2.0, "colored": 5.0},
    "Legal": {"black_and_white": 3.0, "colored": 6.0},
    "Unknown": {"black_and_white": 2.0, "colored": 5.0},
}


def upgrade() -> None:
    op.create_table(
        "document_pricing_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("paper_size", sa.String(), nullable=False),
        sa.Column(
            "print_type",
            sa.Enum(
                "colored",
                "black_and_white",
                name="documentpricingprinttype",
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("paper_size", "print_type"),
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    table = sa.table(
        "document_pricing_rules",
        sa.column("id", sa.String()),
        sa.column("paper_size", sa.String()),
        sa.column("print_type", sa.String()),
        sa.column("price_per_page", sa.Float()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        table,
        [
            {
                "id": str(uuid4()),
                "paper_size": paper_size,
                "print_type": print_type,
                "price_per_page": rate,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for paper_size, rates in DEFAULT_RATES.items()
            for print_type, rate in rates.items()
        ],
    )


def downgrade() -> None:
    op.drop_table("document_pricing_rules")
