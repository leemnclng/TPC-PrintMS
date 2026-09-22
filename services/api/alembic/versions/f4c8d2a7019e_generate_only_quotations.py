"""Remove persistence added for generate-only quotations.

Revision ID: f4c8d2a7019e
Revises: e9b7c41a2d33
"""

from alembic import op
import sqlalchemy as sa


revision = "f4c8d2a7019e"
down_revision = "e9b7c41a2d33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("quotations") as batch_op:
        batch_op.drop_column("notes")
        batch_op.drop_column("valid_until")
    op.drop_table("quotation_number_sequence")


def downgrade() -> None:
    op.create_table(
        "quotation_number_sequence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("next_value", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("quotations") as batch_op:
        batch_op.add_column(sa.Column("valid_until", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))
