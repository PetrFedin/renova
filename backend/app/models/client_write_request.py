"""Persistent client-request ledger for idempotent create operations."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ClientWriteRequest(Base):
    __tablename__ = "client_write_requests"
    __table_args__ = (
        UniqueConstraint(
            "scope",
            "project_id",
            "user_id",
            "request_id",
            name="uq_client_write_request",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scope: Mapped[str] = mapped_column(String(40), index=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
