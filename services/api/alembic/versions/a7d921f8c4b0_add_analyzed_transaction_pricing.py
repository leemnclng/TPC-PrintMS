"""add analyzed transaction pricing

Revision ID: a7d921f8c4b0
Revises: f3c91a7d2e48
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "a7d921f8c4b0"
down_revision: str | None = "f3c91a7d2e48"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.add_column(sa.Column("suggested_total", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("price_overridden", sa.Boolean(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.drop_column("price_overridden")
        batch_op.drop_column("suggested_total")
