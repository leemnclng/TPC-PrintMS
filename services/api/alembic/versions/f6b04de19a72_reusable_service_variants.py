"""Move reusable variants to their parent service.

Revision ID: f6b04de19a72
Revises: e5a93bd07c41
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "f6b04de19a72"
down_revision: str | None = "e5a93bd07c41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "service_variants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("service_id", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["service_id"], ["services.id"], name="fk_service_variants_service_id_services"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_id", "label", name="uq_service_variants_service_label"),
    )
    op.add_column("product_variants", sa.Column("service_variant_id", sa.String(), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            """
            SELECT product_variants.id, product_variants.product_id, product_variants.label, products.service_id
            FROM product_variants
            JOIN products ON products.id = product_variants.product_id
            ORDER BY product_variants.id
            """
        )
    ).mappings()
    now = datetime.now(UTC).replace(tzinfo=None)
    library_ids: dict[tuple[str, str], str] = {}
    product_links: set[tuple[str, str]] = set()
    for row in rows:
        label = row["label"].strip()
        library_key = (row["service_id"], label.casefold())
        service_variant_id = library_ids.get(library_key)
        if service_variant_id is None:
            service_variant_id = str(uuid4())
            library_ids[library_key] = service_variant_id
            connection.execute(
                sa.text(
                    """
                    INSERT INTO service_variants
                        (id, service_id, label, description, is_active, created_at, updated_at)
                    VALUES
                        (:id, :service_id, :label, NULL, 1, :created_at, :updated_at)
                    """
                ),
                {
                    "id": service_variant_id,
                    "service_id": row["service_id"],
                    "label": label,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        product_link = (row["product_id"], service_variant_id)
        if product_link in product_links:
            connection.execute(
                sa.text("DELETE FROM product_variants WHERE id = :id"),
                {"id": row["id"]},
            )
            continue
        product_links.add(product_link)
        connection.execute(
            sa.text("UPDATE product_variants SET service_variant_id = :variant_id WHERE id = :id"),
            {"variant_id": service_variant_id, "id": row["id"]},
        )

    with op.batch_alter_table("product_variants", recreate="always") as batch_op:
        batch_op.alter_column("service_variant_id", existing_type=sa.String(), nullable=False)
        batch_op.create_foreign_key(
            "fk_product_variants_service_variant_id_service_variants",
            "service_variants",
            ["service_variant_id"],
            ["id"],
        )
        batch_op.create_unique_constraint(
            "uq_product_variants_product_service_variant",
            ["product_id", "service_variant_id"],
        )
        batch_op.drop_column("label")


def downgrade() -> None:
    with op.batch_alter_table("product_variants", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("label", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE product_variants
        SET label = (
            SELECT service_variants.label
            FROM service_variants
            WHERE service_variants.id = product_variants.service_variant_id
        )
        """
    )
    with op.batch_alter_table("product_variants", recreate="always") as batch_op:
        batch_op.alter_column("label", existing_type=sa.String(), nullable=False)
        batch_op.drop_constraint("uq_product_variants_product_service_variant", type_="unique")
        batch_op.drop_constraint(
            "fk_product_variants_service_variant_id_service_variants",
            type_="foreignkey",
        )
        batch_op.drop_column("service_variant_id")
    op.drop_table("service_variants")
