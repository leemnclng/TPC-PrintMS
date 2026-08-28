"""Add operator-selected output settings to print attempts.

Revision ID: e8a31d7c5f20
Revises: f7d2c8a9410b
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "e8a31d7c5f20"
down_revision: str | None = "f7d2c8a9410b"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("orientation", sa.String(), server_default="auto", nullable=False))
        batch_op.add_column(sa.Column("scaling", sa.String(), server_default="fit", nullable=False))
        batch_op.add_column(sa.Column("quality", sa.String(), server_default="standard", nullable=False))
        batch_op.add_column(sa.Column("borderless", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("collate", sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("collate")
        batch_op.drop_column("borderless")
        batch_op.drop_column("quality")
        batch_op.drop_column("scaling")
        batch_op.drop_column("orientation")
