"""Add a constrained print type to products.

Revision ID: b8e26f4c9120
Revises: a7c15ef2b804
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8e26f4c9120"
down_revision: str | None = "a7c15ef2b804"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PRINT_TYPE = sa.Enum(
    "colored",
    "black_and_white",
    name="productprinttype",
    create_constraint=True,
)


def upgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("print_type", PRINT_TYPE, nullable=True))

    op.execute("UPDATE products SET print_type = 'black_and_white'")

    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.alter_column(
            "print_type",
            existing_type=PRINT_TYPE,
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("productprinttype", type_="check")
        batch_op.drop_column("print_type")
