"""add audited payment void fields

Revision ID: d6c41e8a2f70
Revises: c4a82f19d631
"""

from alembic import op
import sqlalchemy as sa

revision = "d6c41e8a2f70"
down_revision = "c4a82f19d631"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("voided_at", sa.DateTime(), nullable=True))
    op.add_column("payments", sa.Column("void_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("payments", "void_reason")
    op.drop_column("payments", "voided_at")
