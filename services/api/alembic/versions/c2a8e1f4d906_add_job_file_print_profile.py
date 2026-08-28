"""add job file print profile

Revision ID: c2a8e1f4d906
Revises: b9f12d3e4a60
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "c2a8e1f4d906"
down_revision: str | None = "b9f12d3e4a60"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_files") as batch_op:
        batch_op.add_column(sa.Column("detected_page_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("detected_paper_size", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("detected_orientation", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("detected_color_pages", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("detected_bw_pages", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("estimated_color_coverage_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("estimated_ink_coverage_percent", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("estimated_print_time_seconds", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("analysis_confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job_files") as batch_op:
        batch_op.drop_column("analysis_confidence")
        batch_op.drop_column("estimated_print_time_seconds")
        batch_op.drop_column("estimated_ink_coverage_percent")
        batch_op.drop_column("estimated_color_coverage_percent")
        batch_op.drop_column("detected_bw_pages")
        batch_op.drop_column("detected_color_pages")
        batch_op.drop_column("detected_orientation")
        batch_op.drop_column("detected_paper_size")
        batch_op.drop_column("detected_page_count")
