"""add print color adjustments

Revision ID: c7f2a91d4e60
Revises: b6e4a21c9d70
"""

from alembic import op
import sqlalchemy as sa

revision = "c7f2a91d4e60"
down_revision = "b6e4a21c9d70"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("brightness", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("contrast", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("saturation", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("warmth", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("warmth")
        batch_op.drop_column("saturation")
        batch_op.drop_column("contrast")
        batch_op.drop_column("brightness")
