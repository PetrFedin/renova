"""add the generic client-request replay ledger

``apps/mobile/lib/offlineQueue.ts`` sends a stable ``X-Offline-Id`` on every
replayed mutation and retries up to five times with a 15s timeout, but no
backend code read that header — a repository-wide grep for ``X-Offline-Id``
under ``backend/`` returned nothing. A queued POST that committed and then lost
its response therefore created a duplicate on the next attempt. Only 14 of 84
routers carry the transactional ``client_write_requests`` mechanism.

This table backs ``app.middleware.idempotency``, which claims one execution per
(user, request key), replays the recorded response on a retry, and fails closed
while a claim is still in flight.

Revision ID: w25clientreplay01
Revises: w24moneynumeric01
Create Date: 2026-09-17
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w25clientreplay01"
down_revision: str | None = "w24moneynumeric01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_request_replays",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("request_key", sa.String(length=128), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=512), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("response_media_type", sa.String(length=128), nullable=True),
        sa.Column("response_retained", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "request_key",
            name="uq_client_request_replays_user_request",
        ),
    )
    op.create_index(
        op.f("ix_client_request_replays_user_id"),
        "client_request_replays",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_request_replays_state"),
        "client_request_replays",
        ["state"],
        unique=False,
    )
    # Retention/stuck-claim sweeps scan by age.
    op.create_index(
        op.f("ix_client_request_replays_created_at"),
        "client_request_replays",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_client_request_replays_created_at"),
        table_name="client_request_replays",
    )
    op.drop_index(
        op.f("ix_client_request_replays_state"),
        table_name="client_request_replays",
    )
    op.drop_index(
        op.f("ix_client_request_replays_user_id"),
        table_name="client_request_replays",
    )
    op.drop_table("client_request_replays")
