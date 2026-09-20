"""add reusable job-order discounts

Revision ID: d8a3f1c42b71
Revises: c7f2a91d4e60
"""

from alembic import op
import sqlalchemy as sa

revision = "d8a3f1c42b71"
down_revision = "c7f2a91d4e60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("pricing_discounts") as batch_op:
        batch_op.add_column(sa.Column("scope", sa.String(), server_default="product", nullable=False))
        batch_op.create_check_constraint("ck_pricing_discount_scope", "scope IN ('product', 'job_order')")
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.add_column(sa.Column("discount_template_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("discount_name", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("discount_calculation_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("discount_value", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("discount_amount", sa.Float(), server_default="0", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.drop_column("discount_amount")
        batch_op.drop_column("discount_value")
        batch_op.drop_column("discount_calculation_type")
        batch_op.drop_column("discount_name")
        batch_op.drop_column("discount_template_id")
    with op.batch_alter_table("pricing_discounts") as batch_op:
        batch_op.drop_constraint("ck_pricing_discount_scope", type_="check")
        batch_op.drop_column("scope")
