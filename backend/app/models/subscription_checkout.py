"""Persistent Renova Pro purchase cycles.

A checkout is the financial identity of one paid renewal.  It survives lost HTTP
responses, provider callbacks arriving before the API response, and process
restarts.  ``open_key`` enforces at most one unfinished cycle per user while
remaining NULL for terminal history rows.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class SubscriptionCheckout(Base):
    __tablename__ = "subscription_checkouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    # Equal to user_id only while pending/processing.  A nullable UNIQUE column
    # gives a portable one-open-checkout invariant on SQLite and PostgreSQL.
    open_key: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
        unique=True,
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RUB")
    days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    idempotence_key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    provider_payment_id: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        unique=True,
        index=True,
    )
    confirmation_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    provider_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replay_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
