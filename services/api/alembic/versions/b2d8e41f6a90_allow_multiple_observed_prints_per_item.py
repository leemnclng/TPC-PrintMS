"""Allow rejected and successful observed prints to share one job item.

Revision ID: b2d8e41f6a90
Revises: a1f7c9d2e640
"""

from alembic import op


revision = "b2d8e41f6a90"
down_revision = "a1f7c9d2e640"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.drop_constraint("uq_observed_print_jobs_linked_job_order_item_id", type_="unique")


def downgrade() -> None:
    with op.batch_alter_table("observed_print_jobs") as batch_op:
        batch_op.create_unique_constraint(
            "uq_observed_print_jobs_linked_job_order_item_id",
            ["linked_job_order_item_id"],
        )
