"""add business owner name

Revision ID: f3c91a7d2e48
Revises: e2c7a1f4b6d8
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "f3c91a7d2e48"
down_revision: str | None = "e2c7a1f4b6d8"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "business_profile",
        sa.Column("owner_name", sa.String(), nullable=False, server_default="Owner"),
    )


def downgrade() -> None:
    op.drop_column("business_profile", "owner_name")
