"""add service and product hierarchy

Revision ID: f210db8a914c
Revises: adc10f4274f5
Create Date: 2026-08-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f210db8a914c"
down_revision: Union[str, None] = "adc10f4274f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "services",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.add_column("products", sa.Column("service_id", sa.String(), nullable=True))

    # Preserve existing catalogs by turning every prior category into a service.
    op.execute(
        """
        INSERT INTO services (id, name, description, is_active, created_at, updated_at)
        SELECT
            lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
            substr(lower(hex(randomblob(2))), 2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
            lower(hex(randomblob(6))),
            category,
            NULL,
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM products
        GROUP BY category
        """
    )
    op.execute(
        """
        UPDATE products
        SET service_id = (SELECT services.id FROM services WHERE services.name = products.category)
        """
    )

    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.alter_column("service_id", existing_type=sa.String(), nullable=False)
        batch_op.create_foreign_key("fk_products_service_id_services", "services", ["service_id"], ["id"])
        batch_op.drop_column("category")
        batch_op.create_index("ix_products_service_id", ["service_id"])


def downgrade() -> None:
    op.add_column("products", sa.Column("category", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE products
        SET category = (SELECT services.name FROM services WHERE services.id = products.service_id)
        """
    )

    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.alter_column("category", existing_type=sa.String(), nullable=False)
        batch_op.drop_index("ix_products_service_id")
        batch_op.drop_constraint("fk_products_service_id_services", type_="foreignkey")
        batch_op.drop_column("service_id")

    op.drop_table("services")
