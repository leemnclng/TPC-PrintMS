"""Separate external-print notification deferral from record review.

Revision ID: a6c3e9f1b742
Revises: e5b2d9c8f031
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6c3e9f1b742"
down_revision: str | None = "e5b2d9c8f031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.add_column(sa.Column("notification_dismissed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_column("notification_dismissed_at")
