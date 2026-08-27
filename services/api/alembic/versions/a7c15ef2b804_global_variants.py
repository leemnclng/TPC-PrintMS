"""Promote service variants into one global library.

Revision ID: a7c15ef2b804
Revises: f6b04de19a72
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "a7c15ef2b804"
down_revision: str | None = "f6b04de19a72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "variants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("label", name="uq_variants_label"),
    )
    op.add_column("product_variants", sa.Column("variant_id", sa.String(), nullable=True))

    connection = op.get_bind()
    source_variants = connection.execute(
        sa.text(
            """
            SELECT id, label, description, is_active, created_at, updated_at
            FROM service_variants
            ORDER BY created_at, id
            """
        )
    ).mappings()
    global_by_label: dict[str, str] = {}
    global_by_source_id: dict[str, str] = {}
    global_rows: dict[str, dict] = {}
    for source in source_variants:
        label = source["label"].strip()
        key = label.casefold()
        global_id = global_by_label.get(key)
        if global_id is None:
            global_id = source["id"]
            global_by_label[key] = global_id
            global_rows[global_id] = {
                "id": global_id,
                "label": label,
                "description": source["description"],
                "is_active": source["is_active"],
                "created_at": source["created_at"],
                "updated_at": source["updated_at"],
            }
        else:
            merged = global_rows[global_id]
            if not merged["description"] and source["description"]:
                merged["description"] = source["description"]
            merged["is_active"] = bool(merged["is_active"] or source["is_active"])
            if source["updated_at"] > merged["updated_at"]:
                merged["updated_at"] = source["updated_at"]
        global_by_source_id[source["id"]] = global_id

    for row in global_rows.values():
        connection.execute(
            sa.text(
                """
                INSERT INTO variants (id, label, description, is_active, created_at, updated_at)
                VALUES (:id, :label, :description, :is_active, :created_at, :updated_at)
                """
            ),
            row,
        )

    product_links = connection.execute(
        sa.text("SELECT id, product_id, service_variant_id FROM product_variants ORDER BY id")
    ).mappings()
    seen_links: set[tuple[str, str]] = set()
    for link in product_links:
        global_id = global_by_source_id[link["service_variant_id"]]
        key = (link["product_id"], global_id)
        if key in seen_links:
            connection.execute(sa.text("DELETE FROM product_variants WHERE id = :id"), {"id": link["id"]})
            continue
        seen_links.add(key)
        connection.execute(
            sa.text("UPDATE product_variants SET variant_id = :variant_id WHERE id = :id"),
            {"variant_id": global_id, "id": link["id"]},
        )

    with op.batch_alter_table("product_variants", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_product_variants_product_service_variant", type_="unique")
        batch_op.drop_constraint(
            "fk_product_variants_service_variant_id_service_variants",
            type_="foreignkey",
        )
        batch_op.alter_column("variant_id", existing_type=sa.String(), nullable=False)
        batch_op.create_foreign_key(
            "fk_product_variants_variant_id_variants",
            "variants",
            ["variant_id"],
            ["id"],
        )
        batch_op.create_unique_constraint(
            "uq_product_variants_product_variant",
            ["product_id", "variant_id"],
        )
        batch_op.drop_column("service_variant_id")
    op.drop_table("service_variants")


def downgrade() -> None:
    op.create_table(
        "service_variants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("service_id", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            name="fk_service_variants_service_id_services",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_id", "label", name="uq_service_variants_service_label"),
    )
    op.add_column("product_variants", sa.Column("service_variant_id", sa.String(), nullable=True))

    connection = op.get_bind()
    links = connection.execute(
        sa.text(
            """
            SELECT
                product_variants.id AS product_variant_id,
                products.service_id,
                variants.id AS variant_id,
                variants.label,
                variants.description,
                variants.is_active,
                variants.created_at,
                variants.updated_at
            FROM product_variants
            JOIN products ON products.id = product_variants.product_id
            JOIN variants ON variants.id = product_variants.variant_id
            ORDER BY product_variants.id
            """
        )
    ).mappings()
    service_variant_by_key: dict[tuple[str, str], str] = {}
    used_global_ids: set[str] = set()
    for link in links:
        key = (link["service_id"], link["variant_id"])
        service_variant_id = service_variant_by_key.get(key)
        if service_variant_id is None:
            service_variant_id = str(uuid4())
            service_variant_by_key[key] = service_variant_id
            connection.execute(
                sa.text(
                    """
                    INSERT INTO service_variants
                        (id, service_id, label, description, is_active, created_at, updated_at)
                    VALUES
                        (:id, :service_id, :label, :description, :is_active, :created_at, :updated_at)
                    """
                ),
                {
                    "id": service_variant_id,
                    "service_id": link["service_id"],
                    "label": link["label"],
                    "description": link["description"],
                    "is_active": link["is_active"],
                    "created_at": link["created_at"],
                    "updated_at": link["updated_at"],
                },
            )
        used_global_ids.add(link["variant_id"])
        connection.execute(
            sa.text(
                "UPDATE product_variants SET service_variant_id = :service_variant_id WHERE id = :id"
            ),
            {"service_variant_id": service_variant_id, "id": link["product_variant_id"]},
        )

    first_service_id = connection.execute(
        sa.text("SELECT id FROM services ORDER BY created_at, id LIMIT 1")
    ).scalar()
    has_unlinked_variants = connection.execute(
        sa.text("SELECT EXISTS(SELECT 1 FROM variants)")
    ).scalar()
    if not first_service_id and has_unlinked_variants:
        first_service_id = str(uuid4())
        now = datetime.now(UTC).replace(tzinfo=None)
        connection.execute(
            sa.text(
                """
                INSERT INTO services (id, name, description, is_active, created_at, updated_at)
                VALUES (:id, :name, :description, :is_active, :created_at, :updated_at)
                """
            ),
            {
                "id": first_service_id,
                "name": "Recovered global variants",
                "description": "Created while reverting the global variant library.",
                "is_active": False,
                "created_at": now,
                "updated_at": now,
            },
        )
    if first_service_id:
        unlinked = connection.execute(
            sa.text(
                """
                SELECT id, label, description, is_active, created_at, updated_at
                FROM variants
                ORDER BY created_at, id
                """
            )
        ).mappings()
        for variant in unlinked:
            if variant["id"] in used_global_ids:
                continue
            connection.execute(
                sa.text(
                    """
                    INSERT INTO service_variants
                        (id, service_id, label, description, is_active, created_at, updated_at)
                    VALUES
                        (:id, :service_id, :label, :description, :is_active, :created_at, :updated_at)
                    """
                ),
                {
                    **variant,
                    "id": str(uuid4()),
                    "service_id": first_service_id,
                },
            )

    with op.batch_alter_table("product_variants", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_product_variants_product_variant", type_="unique")
        batch_op.drop_constraint("fk_product_variants_variant_id_variants", type_="foreignkey")
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
        batch_op.drop_column("variant_id")
    op.drop_table("variants")
