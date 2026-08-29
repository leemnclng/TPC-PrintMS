"""Add owner-facing job-order names.

Revision ID: fd92b5e3c017
Revises: bb24b455f13b
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fd92b5e3c017"
down_revision: str | None = "bb24b455f13b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.add_column(sa.Column("name", sa.String(length=100), nullable=True))

    # Existing work has no owner-entered nickname. Its retained source file is
    # the most useful human label; fall back to the durable reference only when
    # no file exists.
    op.execute(
        sa.text(
            "UPDATE job_orders SET name = COALESCE(("
            "SELECT job_files.original_filename FROM job_files "
            "WHERE job_files.job_order_id = job_orders.id "
            "ORDER BY job_files.uploaded_at ASC LIMIT 1"
            "), job_orders.number)"
        )
    )
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.alter_column("name", existing_type=sa.String(length=100), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.drop_column("name")
