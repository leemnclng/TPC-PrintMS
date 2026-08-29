"""Add workflow categories and the built-in Photocopy service.

Revision ID: fe13c6a4d028
Revises: fd92b5e3c017
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "fe13c6a4d028"
down_revision: str | None = "fd92b5e3c017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("services") as batch_op:
        batch_op.add_column(
            sa.Column("category", sa.String(), server_default="custom", nullable=False)
        )
        batch_op.create_check_constraint(
            "ck_services_category", "category IN ('printing', 'photocopy', 'custom')"
        )
    # Every service predating workflow categories used the uploaded-document
    # printing flow. Preserve that behavior regardless of its owner-given name.
    op.execute(sa.text("UPDATE services SET category = 'printing'"))
    op.execute(
        sa.text(
            "UPDATE services SET category = 'photocopy' "
            "WHERE lower(name) IN ('photocopy', 'xerox') "
            "OR lower(name) LIKE 'photocopy %' OR lower(name) LIKE 'xerox %'"
        )
    )

    connection = op.get_bind()
    photocopy_exists = connection.execute(
        sa.text("SELECT 1 FROM services WHERE category = 'photocopy' LIMIT 1")
    ).scalar()
    if not photocopy_exists:
        now = datetime.utcnow()
        connection.execute(
            sa.text(
                "INSERT INTO services "
                "(id, name, category, description, is_active, created_at, updated_at) "
                "VALUES (:id, 'Photocopy', 'photocopy', :description, 1, :now, :now)"
            ),
            {
                "id": str(uuid4()),
                "description": "Device-side photocopy transactions recorded without a document upload.",
                "now": now,
            },
        )

    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.add_column(
            sa.Column("workflow_category", sa.String(), server_default="printing", nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.drop_column("workflow_category")
    with op.batch_alter_table("services") as batch_op:
        batch_op.drop_constraint("ck_services_category", type_="check")
        batch_op.drop_column("category")
