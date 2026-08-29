"""Add durable job numbering and tracked internal print activity.

Revision ID: fc81a4d2b906
Revises: fb24d7a91e30
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fc81a4d2b906"
down_revision: str | None = "fb24d7a91e30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_order_number_sequence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("next_value", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    connection = op.get_bind()
    numbers = connection.execute(sa.text("SELECT number FROM job_orders")).scalars()
    highest = 0
    for number in numbers:
        match = re.search(r"(\d+)$", number or "")
        if match:
            highest = max(highest, int(match.group(1)))
    connection.execute(
        sa.text("INSERT INTO job_order_number_sequence (id, next_value) VALUES (1, :next_value)"),
        {"next_value": highest + 1},
    )

    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("spooler_key", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("spooler_status", sa.String(), server_default="submitted", nullable=False)
        )
        batch_op.add_column(sa.Column("spooler_pages_printed", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("spooler_total_pages", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("spooler_last_seen_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("spooler_released_at", sa.DateTime(), nullable=True))
        batch_op.create_unique_constraint("uq_print_jobs_spooler_key", ["spooler_key"])


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_constraint("uq_print_jobs_spooler_key", type_="unique")
        batch_op.drop_column("spooler_released_at")
        batch_op.drop_column("spooler_last_seen_at")
        batch_op.drop_column("spooler_total_pages")
        batch_op.drop_column("spooler_pages_printed")
        batch_op.drop_column("spooler_status")
        batch_op.drop_column("spooler_key")
    op.drop_table("job_order_number_sequence")
