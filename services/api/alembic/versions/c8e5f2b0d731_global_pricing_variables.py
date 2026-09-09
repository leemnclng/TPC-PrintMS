"""add global pricing variables

Revision ID: c8e5f2b0d731
Revises: b7d4e1a9c620
"""

from alembic import op
import sqlalchemy as sa

revision = "c8e5f2b0d731"
down_revision = "b7d4e1a9c620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "global_pricing_variables",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("calculation_type", sa.String(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("calculation_type IN ('percentage', 'fixed')", name="ck_global_pricing_variable_type"),
        sa.CheckConstraint("value >= 0", name="ck_global_pricing_variable_value"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("global_pricing_variables")
