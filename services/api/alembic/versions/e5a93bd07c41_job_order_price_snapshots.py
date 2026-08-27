"""Add calculated price snapshots to job-order items.

Revision ID: e5a93bd07c41
Revises: d4f7281ce906
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5a93bd07c41"
down_revision: str | None = "d4f7281ce906"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.add_column(sa.Column("unit_price", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("line_total", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("job_order_items") as batch_op:
        batch_op.drop_column("line_total")
        batch_op.drop_column("unit_price")
