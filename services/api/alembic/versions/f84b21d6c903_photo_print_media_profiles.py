"""Add Photo Print and persist selected print media.

Revision ID: f84b21d6c903
Revises: e7a4c91d26f8
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "f84b21d6c903"
down_revision: str | None = "e7a4c91d26f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    op.execute(
        sa.text(
            """
            INSERT INTO print_types
                (key, label, description, color_mode, applies_ink_coverage,
                 is_active, sort_order, created_at, updated_at)
            SELECT
                'photo_print', 'Photo Print',
                'High-quality color photo output with photo-media and crop-aware printing controls.',
                'color', 1, 1, 40, :now, :now
            WHERE NOT EXISTS (SELECT 1 FROM print_types WHERE key = 'photo_print')
            """
        ).bindparams(now=now)
    )
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(
            sa.Column("media_type", sa.String(), nullable=False, server_default="auto")
        )


def downgrade() -> None:
    connection = op.get_bind()
    usage = connection.execute(
        sa.text(
            """
            SELECT
                (SELECT COUNT(*) FROM products WHERE print_type = 'photo_print') +
                (SELECT COUNT(*) FROM document_pricing_rules WHERE print_type = 'photo_print')
            """
        )
    ).scalar_one()
    if usage:
        raise RuntimeError("Cannot downgrade while products or pricing rules use Photo Print.")
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("media_type")
    connection.execute(sa.text("DELETE FROM print_types WHERE key = 'photo_print'"))
