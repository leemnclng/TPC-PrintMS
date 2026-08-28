"""Replace fixed print-type enums with an owner-managed catalog.

Revision ID: f7d2c8a9410b
Revises: c2a8e1f4d906
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "f7d2c8a9410b"
down_revision: str | None = "c2a8e1f4d906"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_PRODUCT_PRINT_TYPE = sa.Enum(
    "colored", "black_and_white", name="productprinttype", create_constraint=True
)
OLD_PRICING_PRINT_TYPE = sa.Enum(
    "colored", "black_and_white", name="documentpricingprinttype", create_constraint=True
)


def upgrade() -> None:
    op.create_table(
        "print_types",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color_mode", sa.String(), nullable=False),
        sa.Column("applies_ink_coverage", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        sa.UniqueConstraint("label", name="uq_print_types_label"),
        sa.CheckConstraint("color_mode IN ('color', 'grayscale')", name="ck_print_types_color_mode"),
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    print_types = sa.table(
        "print_types",
        sa.column("key", sa.String()),
        sa.column("label", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("color_mode", sa.String()),
        sa.column("applies_ink_coverage", sa.Boolean()),
        sa.column("is_active", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        print_types,
        [
            {
                "key": "black_and_white",
                "label": "B&W (Black and white)",
                "description": "Grayscale output; the configured rate already includes paper and ink.",
                "color_mode": "grayscale",
                "applies_ink_coverage": False,
                "is_active": True,
                "sort_order": 10,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "semi_colored",
                "label": "Semi-colored",
                "description": "Color output for documents with limited color use.",
                "color_mode": "color",
                "applies_ink_coverage": True,
                "is_active": True,
                "sort_order": 20,
                "created_at": now,
                "updated_at": now,
            },
            {
                "key": "colored",
                "label": "Colored",
                "description": "Full color output with measured ink coverage pricing.",
                "color_mode": "color",
                "applies_ink_coverage": True,
                "is_active": True,
                "sort_order": 30,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )

    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("productprinttype", type_="check")
        batch_op.alter_column(
            "print_type",
            existing_type=OLD_PRODUCT_PRINT_TYPE,
            type_=sa.String(),
            existing_nullable=False,
        )
        batch_op.create_foreign_key(
            "fk_products_print_type_print_types", "print_types", ["print_type"], ["key"]
        )

    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.drop_constraint("documentpricingprinttype", type_="check")
        batch_op.alter_column(
            "print_type",
            existing_type=OLD_PRICING_PRINT_TYPE,
            type_=sa.String(),
            existing_nullable=False,
        )
        batch_op.create_foreign_key(
            "fk_document_pricing_rules_print_type_print_types",
            "print_types",
            ["print_type"],
            ["key"],
        )


def downgrade() -> None:
    connection = op.get_bind()
    unsupported_products = connection.execute(
        sa.text(
            "SELECT COUNT(*) FROM products WHERE print_type NOT IN ('black_and_white', 'colored')"
        )
    ).scalar_one()
    if unsupported_products:
        raise RuntimeError("Cannot downgrade while products use Semi-colored or custom print types.")
    connection.execute(
        sa.text(
            "DELETE FROM document_pricing_rules WHERE print_type NOT IN ('black_and_white', 'colored')"
        )
    )
    with op.batch_alter_table("document_pricing_rules", recreate="always") as batch_op:
        batch_op.drop_constraint(
            "fk_document_pricing_rules_print_type_print_types", type_="foreignkey"
        )
        batch_op.alter_column(
            "print_type",
            existing_type=sa.String(),
            type_=OLD_PRICING_PRINT_TYPE,
            existing_nullable=False,
        )
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("fk_products_print_type_print_types", type_="foreignkey")
        batch_op.alter_column(
            "print_type",
            existing_type=sa.String(),
            type_=OLD_PRODUCT_PRINT_TYPE,
            existing_nullable=False,
        )
    op.drop_table("print_types")
