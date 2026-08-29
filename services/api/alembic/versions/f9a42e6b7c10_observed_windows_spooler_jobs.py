"""Persist jobs observed in the Windows print spooler.

Revision ID: f9a42e6b7c10
Revises: e8a31d7c5f20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9a42e6b7c10"
down_revision: str | None = "e8a31d7c5f20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "observed_print_jobs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("spooler_key", sa.String(), nullable=False),
        sa.Column("os_job_id", sa.String(), nullable=False),
        sa.Column("printer_name", sa.String(), nullable=False),
        sa.Column("document_name", sa.String(), nullable=False),
        sa.Column("owner", sa.String(), nullable=True),
        sa.Column("driver_name", sa.String(), nullable=True),
        sa.Column("total_pages", sa.Integer(), nullable=True),
        sa.Column("pages_printed", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), server_default="queued", nullable=False),
        sa.Column("raw_status", sa.String(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("spooler_key", name="uq_observed_print_jobs_spooler_key"),
    )
    op.create_index(
        "ix_observed_print_jobs_last_seen_at",
        "observed_print_jobs",
        ["last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_observed_print_jobs_last_seen_at", table_name="observed_print_jobs")
    op.drop_table("observed_print_jobs")
