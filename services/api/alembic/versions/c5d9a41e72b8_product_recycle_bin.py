"""Add five-day product recycle bin.

Revision ID: c5d9a41e72b8
Revises: b3e7f24a9c15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d9a41e72b8"
down_revision: str | None = "b3e7f24a9c15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("purge_after", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("deletion_finalized_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("deleted_was_active", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.drop_column("deleted_was_active")
        batch_op.drop_column("deletion_finalized_at")
        batch_op.drop_column("purge_after")
        batch_op.drop_column("deleted_at")
