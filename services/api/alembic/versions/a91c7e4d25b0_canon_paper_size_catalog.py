"""Expand inventory paper sizes with canonical measurements.

Revision ID: a91c7e4d25b0
Revises: f84b21d6c903
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a91c7e4d25b0"
down_revision: str | None = "f84b21d6c903"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PAPER_SIZE_VALUES = (
    "Letter",
    "Legal",
    "Executive",
    "A6",
    "A5",
    "A4",
    "B5",
    "B-Oficio",
    "M-Oficio",
    "Foolscap/F4/Oficio2",
    "Legal (India)",
    "4\"x6\"",
    "5\"x7\"",
    "7\"x10\"",
    "8\"x10\"",
    "L",
    "2L",
    "Square 3.5\"x3.5\"",
    "Square 5\"x5\"",
    "Hagaki",
    "Hagaki 2",
    "Envelope #10",
    "Envelope DL",
    "Nagagata 3",
    "Nagagata 4",
    "Yougata 4",
    "Yougata 6",
    "Envelope C5",
    "Envelope Monarch",
    "Card 55x91mm",
    "Custom",
)


def upgrade() -> None:
    allowed = ", ".join(f"'{value.replace(chr(39), chr(39) * 2)}'" for value in PAPER_SIZE_VALUES)
    with op.batch_alter_table("inventory_items", recreate="always") as batch_op:
        batch_op.drop_constraint("inventorypapersize", type_="check")
        batch_op.alter_column(
            "paper_size",
            existing_type=sa.String(),
            type_=sa.String(),
            existing_nullable=True,
        )
        batch_op.add_column(sa.Column("paper_width_mm", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("paper_height_mm", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "inventorypapersize",
            f"paper_size IS NULL OR paper_size IN ({allowed})",
        )

    connection = op.get_bind()
    dimensions = {
        "A4": (210.0, 297.0),
        "Letter": (215.9, 279.4),
        "Legal": (215.9, 355.6),
    }
    for paper_size, (width_mm, height_mm) in dimensions.items():
        connection.execute(
            sa.text(
                """
                UPDATE inventory_items
                SET paper_width_mm = :width_mm, paper_height_mm = :height_mm
                WHERE paper_size = :paper_size
                """
            ),
            {"paper_size": paper_size, "width_mm": width_mm, "height_mm": height_mm},
        )

    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.add_column(sa.Column("media_width_mm", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("media_height_mm", sa.Float(), nullable=True))
    for paper_size, (width_mm, height_mm) in dimensions.items():
        connection.execute(
            sa.text(
                """
                UPDATE print_jobs
                SET media_width_mm = :width_mm, media_height_mm = :height_mm
                WHERE media_size = :paper_size
                """
            ),
            {"paper_size": paper_size, "width_mm": width_mm, "height_mm": height_mm},
        )


def downgrade() -> None:
    connection = op.get_bind()
    unsupported = connection.execute(
        sa.text(
            """
            SELECT COUNT(*) FROM inventory_items
            WHERE paper_size IS NOT NULL
              AND paper_size NOT IN ('A4', 'Letter', 'Legal')
            """
        )
    ).scalar_one()
    if unsupported:
        raise RuntimeError("Cannot downgrade while inventory uses an expanded Canon paper size.")

    with op.batch_alter_table("print_jobs") as batch_op:
        batch_op.drop_column("media_height_mm")
        batch_op.drop_column("media_width_mm")
    with op.batch_alter_table("inventory_items", recreate="always") as batch_op:
        batch_op.drop_constraint("inventorypapersize", type_="check")
        batch_op.drop_column("paper_height_mm")
        batch_op.drop_column("paper_width_mm")
        batch_op.create_check_constraint(
            "inventorypapersize",
            "paper_size IS NULL OR paper_size IN ('A4', 'Letter', 'Legal')",
        )
