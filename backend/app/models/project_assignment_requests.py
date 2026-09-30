"""Contractor self-claims on a project that wait for the customer's decision.

A contractor who says "I want to lead this project" never becomes the lead by
that statement alone: the claim is stored here as ``pending`` and only the
project's customer can turn it into ``Project.contractor_id`` (accept) or close
it (decline). At most one pending claim exists per (project, contractor).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


ASSIGNMENT_REQUEST_STATUSES = frozenset(
    {"pending", "accepted", "declined", "superseded"}
)


class ProjectAssignmentRequest(Base):
    __tablename__ = "project_assignment_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','accepted','declined','superseded')",
            name="ck_project_assignment_requests_status",
        ),
        # Idempotency: a repeated claim by the same contractor reuses this row.
        Index(
            "uq_project_assignment_requests_pending",
            "project_id", "contractor_id",
            unique=True,
            sqlite_where=text("status = 'pending'"),
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    contractor_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
