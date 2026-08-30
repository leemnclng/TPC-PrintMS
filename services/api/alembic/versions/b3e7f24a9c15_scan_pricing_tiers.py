"""Replace per-print-type Scan pricing with per-page-count tiers.

A scan's price never depends on paper size or color — only on how many
pages were scanned — so the per-print-type table from the previous
migration is dropped in favor of owner-managed page-count tiers.

Revision ID: b3e7f24a9c15
Revises: a4f8c31e0d97
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3e7f24a9c15"
down_revision: str | None = "a4f8c31e0d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("scan_pricing_rules")
    op.create_table(
        "scan_pricing_tiers",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("min_pages", sa.Integer(), nullable=False),
        sa.Column("max_pages", sa.Integer(), nullable=True),
        sa.Column("price_per_page", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("min_pages >= 1", name="ck_scan_pricing_tiers_min_pages"),
        sa.CheckConstraint("max_pages IS NULL OR max_pages >= min_pages", name="ck_scan_pricing_tiers_max_pages"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("scan_pricing_tiers")
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
