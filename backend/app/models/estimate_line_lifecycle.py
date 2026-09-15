"""Lifecycle and provenance metadata for estimate lines.

Active commercial rows live in ``estimate_lines``. A user remove creates a
lossless tombstone here before the active row is deleted; restore recreates the
same estimate-line identity from that snapshot. This keeps legacy read models
safe because inactive rows cannot accidentally participate in calculations.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
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

    # Intentionally not a foreign key: the lifecycle row must survive while the
    # active EstimateLine row is absent.
    estimate_line_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    origin: Mapped[str] = mapped_column(String(16), default="manual", index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    removed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
