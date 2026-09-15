"""add business expenses

Revision ID: b6e4a21c9d70
Revises: a7c2e94f1b30
"""

from alembic import op
import sqlalchemy as sa

revision = "b6e4a21c9d70"
down_revision = "a7c2e94f1b30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "business_expenses",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=240), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("paid_to", sa.String(length=200), nullable=True),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("spent_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_business_expenses_amount"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("business_expenses")
