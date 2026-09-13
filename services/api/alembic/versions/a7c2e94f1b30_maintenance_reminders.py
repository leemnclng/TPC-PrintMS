"""add maintenance reminders

Revision ID: a7c2e94f1b30
Revises: e1b72c4d9a63
"""

from alembic import op
import sqlalchemy as sa

revision = "a7c2e94f1b30"
down_revision = "e1b72c4d9a63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "maintenance_reminders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("message", sa.String(length=240), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("maintenance_reminders")
