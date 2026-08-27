"""Make the job-order customer optional.

Revision ID: d4f7281ce906
Revises: c8d41e7ab523
"""

from collections.abc import Sequence
from datetime import datetime
import uuid

import sqlalchemy as sa
from alembic import op

revision: str = "d4f7281ce906"
down_revision: str | None = "c8d41e7ab523"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.alter_column("customer_id", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    connection = op.get_bind()
    null_order_count = connection.execute(
        sa.text("SELECT COUNT(*) FROM job_orders WHERE customer_id IS NULL")
    ).scalar_one()
    if null_order_count:
        fallback_customer_id = str(uuid.uuid4())
        now = datetime.utcnow()
        connection.execute(
            sa.text(
                """
                INSERT INTO customers (
                    id, display_name, contact_name, email, phone, source_channel,
                    notes, created_at, updated_at
                ) VALUES (
                    :id, :display_name, NULL, NULL, NULL, :source_channel,
                    :notes, :created_at, :updated_at
                )
                """
            ),
            {
                "id": fallback_customer_id,
                "display_name": "Walk-in orders (migration)",
                "source_channel": "walk_in",
                "notes": "Created automatically while rolling back optional job-order customers.",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            sa.text("UPDATE job_orders SET customer_id = :customer_id WHERE customer_id IS NULL"),
            {"customer_id": fallback_customer_id},
        )
    with op.batch_alter_table("job_orders") as batch_op:
        batch_op.alter_column("customer_id", existing_type=sa.String(), nullable=False)
