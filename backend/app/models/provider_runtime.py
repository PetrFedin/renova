"""Durable provider-read reconciliation state.

Outbound side effects remain owned by DomainOutbox. This ledger is only for
operations where Renova must periodically read authoritative provider truth
(e.g. YooKassa payment state or FNS receipt verification).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class ProviderReconciliation(Base):
    __tablename__ = "provider_reconciliations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'retry', 'completed', 'terminal', 'unavailable')",
            name="ck_provider_reconciliations_status",
        ),
        UniqueConstraint(
            "provider",
            "operation_type",
            "resource_type",
            "resource_id",
            name="uq_provider_reconciliation_resource",
        ),
        Index(
            "ix_provider_reconciliations_due",
            "status",
            "next_attempt_at",
            "locked_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    operation_type: Mapped[str] = mapped_column(String(48), index=True)
    resource_type: Mapped[str] = mapped_column(String(48), index=True)
    resource_id: Mapped[str] = mapped_column(String(64), index=True)
    provider_resource_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)

    # pending|retry|completed|terminal|unavailable
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    provider_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    claim_generation: Mapped[int] = mapped_column(Integer, default=0)

    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_by: Mapped[str | None] = mapped_column(String(96), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    # Bounded, non-secret diagnostics only. Never persist raw request/response
    # bodies, credentials, tokens, Authorization headers or provider payloads.
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
