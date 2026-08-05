"""Persistent Renova Pro purchase, refund, and entitlement history."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
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
    # Equal to user_id only while pending/processing. A nullable UNIQUE column
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

    # A paid grant must be reversible without guessing what entitlement existed
    # before it. These snapshots also preserve an active trial or legacy Pro
    # remainder when the paid purchase is later fully refunded.
    entitlement_before_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    entitlement_before_plan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entitlement_before_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    entitlement_after_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refunded_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    entitlement_reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replay_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )


class SubscriptionRefund(Base):
    """One provider refund plus its durable operational review state."""

    __tablename__ = "subscription_refunds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    checkout_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("subscription_checkouts.id"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    provider_refund_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )
    provider_payment_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # partial|applied|manual_review|dismissed
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    entitlement_changed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # not_required|open|claimed|resolved. Claims are leases so abandoned
    # operator sessions do not leave a review permanently stuck.
    review_status: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="not_required",
        index=True,
    )
    review_owner_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    review_claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
        index=True,
    )
    review_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resolution: Mapped[str | None] = mapped_column(String(48), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_key: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
        unique=True,
    )
    reviewed_by_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SubscriptionRefundReviewEvent(Base):
    """Immutable audit event for every refund-review state transition."""

    __tablename__ = "subscription_refund_review_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    refund_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("subscription_refunds.id"),
        nullable=False,
        index=True,
    )
    actor_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utc_now,
        index=True,
    )
