"""replace product material recipes with quantity-free assignments

Revision ID: b7a32f6c9e10
Revises: 8d49c2a071b4
Create Date: 2026-08-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7a32f6c9e10"
down_revision: Union[str, None] = "8d49c2a071b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(
        "ix_product_material_requirements_product_id",
        table_name="product_material_requirements",
    )
    op.rename_table("product_material_requirements", "product_material_assignments")
    with op.batch_alter_table("product_material_assignments", recreate="always") as batch_op:
        batch_op.drop_column("quantity_per_unit")
    op.create_index(
        "ix_product_material_assignments_product_id",
        "product_material_assignments",
        ["product_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_product_material_assignments_product_id",
        table_name="product_material_assignments",
    )
    with op.batch_alter_table("product_material_assignments", recreate="always") as batch_op:
        batch_op.add_column(
            sa.Column(
                "quantity_per_unit",
                sa.Float(),
                nullable=False,
                server_default=sa.text("1"),
            )
        )
    op.rename_table("product_material_assignments", "product_material_requirements")
    op.create_index(
        "ix_product_material_requirements_product_id",
        "product_material_requirements",
        ["product_id"],
    )
