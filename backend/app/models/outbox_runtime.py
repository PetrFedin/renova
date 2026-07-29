"""Runtime state for safe domain-outbox claiming and idempotent delivery."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class DomainOutboxLease(Base):
    """Cross-process lease and retry schedule for one domain-outbox row."""

    __tablename__ = "domain_outbox_leases"

    outbox_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("domain_outbox.id", ondelete="CASCADE"),
        primary_key=True,
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class SideEffectDelivery(Base):
    """Exactly-once local entity ledger for a domain-outbox side effect."""

    __tablename__ = "side_effect_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    outbox_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("domain_outbox.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    effect_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
