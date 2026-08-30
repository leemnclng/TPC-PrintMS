"""Add global per-print-type pricing rules for Scan products.

Revision ID: a4f8c31e0d97
Revises: d352af906b41
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4f8c31e0d97"
down_revision: str | None = "d352af906b41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scan_pricing_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("print_type", sa.String(), nullable=False),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["print_type"], ["print_types.key"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("print_type"),
    )


def downgrade() -> None:
    op.drop_table("scan_pricing_rules")
