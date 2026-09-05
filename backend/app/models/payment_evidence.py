"""Authoritative manual-payment evidence metadata and review history."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


class PaymentEvidence(Base):
    """One immutable evidence version bound to exactly one project payment.

    Storage is intentionally two-phase: the row is first created as an upload
    intent, then the object is read back and validated before status becomes
    ``submitted``. Review never overwrites a rejected historical version.
    """

    __tablename__ = "payment_evidence"
    __table_args__ = (
        UniqueConstraint("payment_id", "version", name="uq_payment_evidence_payment_version"),
        UniqueConstraint("storage_key", name="uq_payment_evidence_storage_key"),
        CheckConstraint(
            "status IN ('upload_pending','submitted','rejected','approved')",
            name="ck_payment_evidence_status",
        ),
        CheckConstraint("version > 0", name="ck_payment_evidence_version_positive"),
        CheckConstraint("byte_size IS NULL OR byte_size > 0", name="ck_payment_evidence_byte_size_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    payment_id: Mapped[str] = mapped_column(String(36), ForeignKey("payments.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="upload_pending", index=True)

    storage_key: Mapped[str] = mapped_column(String(512))
    original_filename: Mapped[str] = mapped_column(String(255))
    declared_content_type: Mapped[str] = mapped_column(String(96))
    verified_content_type: Mapped[str | None] = mapped_column(String(96), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    submitted_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
