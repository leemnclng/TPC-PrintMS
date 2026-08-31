"""Let several observed Windows print jobs share one job order.

An ad-hoc job order records production that already happened in another
app (e.g. Canon PRINT) — it can now combine more than one already-tracked
print. That means `linked_job_order_id` can no longer be unique (several
observed prints legitimately point at the same job order); the per-print
relationship instead belongs on the specific line item it recorded, via a
new, uniquely-constrained `linked_job_order_item_id`.

Revision ID: c3f8a02d94b1
Revises: a91c7e4d25b0
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a02d94b1"
down_revision: str | None = "a91c7e4d25b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_constraint("uq_observed_print_jobs_linked_job_order_id", type_="unique")
        batch_op.add_column(sa.Column("linked_job_order_item_id", sa.String(), nullable=True))
        batch_op.create_unique_constraint(
            "uq_observed_print_jobs_linked_job_order_item_id", ["linked_job_order_item_id"]
        )
        batch_op.create_foreign_key(
            "fk_observed_print_jobs_linked_job_order_item_id_job_order_items",
            "job_order_items",
            ["linked_job_order_item_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_constraint(
            "fk_observed_print_jobs_linked_job_order_item_id_job_order_items", type_="foreignkey"
        )
        batch_op.drop_constraint("uq_observed_print_jobs_linked_job_order_item_id", type_="unique")
        batch_op.drop_column("linked_job_order_item_id")
        batch_op.create_unique_constraint(
            "uq_observed_print_jobs_linked_job_order_id", ["linked_job_order_id"]
        )
