"""Lifecycle and provenance metadata for estimate lines.

EstimateLine remains the commercial line identity. This sidecar keeps reversible
remove/restore state and source provenance without turning quantity=0 or a hard
DELETE into lifecycle semantics.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


ESTIMATE_LINE_ORIGINS = frozenset({"system", "manual", "import"})
ESTIMATE_LINE_STATUSES = frozenset({"active", "removed"})


class EstimateLineLifecycle(Base):
    __tablename__ = "estimate_line_lifecycles"
    __table_args__ = (
        CheckConstraint(
            "origin IN ('system','manual','import')",
            name="ck_estimate_line_lifecycles_origin",
        ),
        CheckConstraint(
            "status IN ('active','removed')",
            name="ck_estimate_line_lifecycles_status",
        ),
    )

    estimate_line_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("estimate_lines.id", ondelete="CASCADE"),
        primary_key=True,
    )
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    origin: Mapped[str] = mapped_column(String(16), default="manual", index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    removed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
