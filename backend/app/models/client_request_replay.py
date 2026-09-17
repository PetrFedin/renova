"""Durable replay ledger for client-originated mutations.

The mobile offline queue already sends a stable ``X-Offline-Id`` on every
replayed mutation (``apps/mobile/lib/offlineQueue.ts``), but nothing on the
server read it. A queued POST that commits and then loses its response is
retried up to five times, so the same payment, expense, change order or work
acceptance could be created repeatedly.

This table records one claim per (user, client request id). It is deliberately
separate from ``client_write_requests``:

* ``client_write_requests`` is the *transactional* mechanism — a route opts in,
  and the ledger row commits inside the same transaction as the entity. That is
  strictly stronger and remains the preferred design for new routes.
* this table is the *generic* safety net for the routes that have no such
  support yet. It cannot join the route transaction, so it fails closed instead
  of guessing (see ``app.middleware.idempotency``).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base

# Claim states.
STATE_IN_PROGRESS = "in_progress"
STATE_COMPLETED = "completed"


def _uuid() -> str:
    return str(uuid.uuid4())


class ClientRequestReplay(Base):
    __tablename__ = "client_request_replays"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "request_key",
            name="uq_client_request_replays_user_request",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    request_key: Mapped[str] = mapped_column(String(128), nullable=False)

    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    # Canonical hash of method + path + raw body. A reused key with a different
    # payload is a client bug and must never silently replay the wrong answer.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default=STATE_IN_PROGRESS, index=True
    )
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_media_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # False when the response was too large to retain; a replay then fails
    # closed rather than returning a wrong or empty body.
    response_retained: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now, index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
