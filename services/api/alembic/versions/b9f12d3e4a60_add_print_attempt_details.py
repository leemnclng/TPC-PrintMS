"""add print attempt details

Revision ID: b9f12d3e4a60
Revises: a7d921f8c4b0
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "b9f12d3e4a60"
down_revision: str | None = "a7d921f8c4b0"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("job_file_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("external_job_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("error_message", sa.Text(), nullable=True))
        batch_op.create_foreign_key("fk_print_jobs_job_file_id", "job_files", ["job_file_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_constraint("fk_print_jobs_job_file_id", type_="foreignkey")
        batch_op.drop_column("error_message")
        batch_op.drop_column("external_job_id")
        batch_op.drop_column("job_file_id")
