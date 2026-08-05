"""Persistent exactly-once ledger for periodic reminder notifications."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class ReminderDelivery(Base):
    __tablename__ = "reminder_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    notification_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("app_notifications.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    locked_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
