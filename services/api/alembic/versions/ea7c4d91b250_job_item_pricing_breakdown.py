"""store job item pricing breakdown

Revision ID: ea7c4d91b250
Revises: d9f603c1e842
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "ea7c4d91b250"
down_revision: Union[str, None] = "d9f603c1e842"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column("job_order_items", sa.Column("pricing_breakdown_snapshot", sa.Text(), nullable=False, server_default="[]"))

def downgrade() -> None:
    op.drop_column("job_order_items", "pricing_breakdown_snapshot")
