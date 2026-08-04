"""Calendar persistence model and compatibility registration.

Calendar was introduced as a canonical runtime module before its ORM projection
was registered in the shared metadata. Keep the model isolated here to avoid
expanding the already large entities module, while re-exporting it for legacy
imports during the decomposition period.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models import entities


# Declarative classes support adding mapped columns after declaration. Register the
# feed token once so User construction, metadata creation and ICS lookup agree.
if not hasattr(entities.User, "ics_token"):
    entities.User.ics_token = mapped_column(
        String(128),
        nullable=True,
        unique=True,
        index=True,
    )


class CalendarItem(Base):
    __tablename__ = "calendar_items"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=entities._uuid
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id"), nullable=True, index=True
    )
    stage_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("stages.id"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    event_type: Mapped[str] = mapped_column(String(64), default="other", index=True)
    color: Mapped[str | None] = mapped_column(String(7), default="#4F46E5", nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    recurrence: Mapped[str | None] = mapped_column(String(128), nullable=True)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )


# Transitional compatibility for modules and integrations that still import every
# ORM class from app.models.entities. New code should import from this module.
entities.CalendarItem = CalendarItem
