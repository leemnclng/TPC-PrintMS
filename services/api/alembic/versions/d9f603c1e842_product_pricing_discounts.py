"""add product pricing discounts

Revision ID: d9f603c1e842
Revises: c8e5f2b0d731
"""

from alembic import op
import sqlalchemy as sa

revision = "d9f603c1e842"
down_revision = "c8e5f2b0d731"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pricing_discounts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("calculation_type", sa.String(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("calculation_type IN ('percentage', 'fixed')", name="ck_pricing_discount_type"),
        sa.CheckConstraint("value >= 0", name="ck_pricing_discount_value"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "pricing_discount_products",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("discount_id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["discount_id"], ["pricing_discounts.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("discount_id", "product_id"),
    )


def downgrade() -> None:
    op.drop_table("pricing_discount_products")
    op.drop_table("pricing_discounts")
