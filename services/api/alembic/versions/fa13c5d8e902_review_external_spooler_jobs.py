"""Allow external spooler jobs to be reviewed and linked.

Revision ID: fa13c5d8e902
Revises: f9a42e6b7c10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fa13c5d8e902"
down_revision: str | None = "f9a42e6b7c10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.add_column(
            sa.Column("review_status", sa.String(), server_default="unreviewed", nullable=False)
        )
        batch_op.add_column(sa.Column("reviewed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("linked_job_order_id", sa.String(), nullable=True))
        batch_op.create_unique_constraint(
            "uq_observed_print_jobs_linked_job_order_id", ["linked_job_order_id"]
        )
        batch_op.create_foreign_key(
            "fk_observed_print_jobs_linked_job_order_id_job_orders",
            "job_orders",
            ["linked_job_order_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_constraint(
            "fk_observed_print_jobs_linked_job_order_id_job_orders", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "uq_observed_print_jobs_linked_job_order_id", type_="unique"
        )
        batch_op.drop_column("linked_job_order_id")
        batch_op.drop_column("reviewed_at")
        batch_op.drop_column("review_status")
