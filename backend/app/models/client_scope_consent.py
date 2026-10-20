"""Customer-consent records. The proposal and customer decision are append-only facts.

A scope approval is NOT an authorization for arbitrary existing Payment, Expense or
Purchase rows. Those canonical writers need their own allocation/guard release.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import uuid

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _id() -> str:
    return str(uuid.uuid4())


class ClientScopeVersion(Base):
    __tablename__ = "client_scope_versions"
    __table_args__ = (
        UniqueConstraint(
            "work_order_id", "version",
            name="uq_client_scope_work_order_version",
        ),
        UniqueConstraint(
            "project_id", "created_by", "client_request_id",
            name="uq_client_scope_client_request",
        ),
        CheckConstraint("version > 0", name="ck_client_scope_version_positive"),
        CheckConstraint("amount_cap > 0", name="ck_client_scope_amount_positive"),
        CheckConstraint("quantity > 0", name="ck_client_scope_quantity_positive"),
        CheckConstraint("unit_price > 0", name="ck_client_scope_unit_price_positive"),
        CheckConstraint("currency = 'RUB'", name="ck_client_scope_rub_only"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    work_order_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("work_orders.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    client_request_id: Mapped[str] = mapped_column(String(80), nullable=False)
    work_order_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    specialist_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    amount_cap: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="RUB", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


class ClientScopeDecision(Base):
    __tablename__ = "client_scope_decisions"
    __table_args__ = (
        UniqueConstraint("scope_version_id", name="uq_client_scope_one_decision"),
        CheckConstraint(
            "decision IN ('approved', 'rejected')",
            name="ck_client_scope_decision",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    scope_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("client_scope_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    approved_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


class ClientFinancialAuthorization(Base):
    __tablename__ = "client_financial_authorizations"
    __table_args__ = (
        UniqueConstraint("decision_id", name="uq_client_financial_decision"),
        CheckConstraint("amount_cap > 0", name="ck_client_financial_cap_positive"),
        CheckConstraint(
            "committed_amount >= 0 AND committed_amount <= amount_cap",
            name="ck_client_financial_committed_within_cap",
        ),
        CheckConstraint(
            "consumed_amount >= 0 AND consumed_amount <= committed_amount",
            name="ck_client_financial_consumed_within_commitment",
        ),
        CheckConstraint("currency = 'RUB'", name="ck_client_financial_rub_only"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    scope_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("client_scope_versions.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    decision_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("client_scope_decisions.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    amount_cap: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    committed_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False,
    )
    consumed_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False,
    )
    currency: Mapped[str] = mapped_column(String(3), default="RUB", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
