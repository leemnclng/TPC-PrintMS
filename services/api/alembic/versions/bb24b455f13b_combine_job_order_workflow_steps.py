"""Combine the job order workflow steps: no pre-print payment gate, no
separate quality-check status.

A job order is now placed directly into the print queue on creation, and
quality inspection lives inside the Ready step instead of its own status.
Existing rows created under the old lifecycle are remapped onto the closest
equivalent step so the ``joborderstatus`` enum column keeps loading cleanly.

Revision ID: bb24b455f13b
Revises: fc81a4d2b906
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bb24b455f13b"
down_revision: str | None = "fc81a4d2b906"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    # pending_payment jobs were awaiting payment before printing; under the
    # new lifecycle they sit in the queue and collect payment at Ready instead.
    connection.execute(sa.text("UPDATE job_orders SET status = 'queued' WHERE status = 'pending_payment'"))
    # quality_check jobs were mid quality-review; that review now happens
    # inside Ready.
    connection.execute(sa.text("UPDATE job_orders SET status = 'ready' WHERE status = 'quality_check'"))


def downgrade() -> None:
    # Which queued/ready rows were originally pending_payment/quality_check
    # is not recoverable, so this data remap has no meaningful downgrade.
    pass
