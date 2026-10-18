"""Immutable provider refund evidence for one project payment (separate from Pro)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class ProjectPaymentRefund(Base):
    """One captured provider refund; payment.amount remains gross/invoice truth."""

    __tablename__ = "project_payment_refunds"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_project_payment_refund_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    payment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("payments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_payment_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    provider_refund_id: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RUB")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
