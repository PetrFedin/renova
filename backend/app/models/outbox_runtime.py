"""Runtime state for safe domain-outbox claiming and idempotent delivery."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
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


class ExpoPushReceipt(Base):
    """Durable Expo ticket -> receipt reconciliation state.

    The raw Expo token deliberately remains only in ``push_tokens``.  This ledger
    stores a one-way fingerprint so a delayed DeviceNotRegistered receipt cannot
    delete a token row whose value has since changed.
    """

    __tablename__ = "expo_push_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    expo_receipt_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    push_token_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("push_tokens.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    token_fingerprint: Mapped[str] = mapped_column(String(64))
    delivery_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    provider_error: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_by: Mapped[str | None] = mapped_column(String(96), nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
