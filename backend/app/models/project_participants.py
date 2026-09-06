"""Project-scoped contractor principals and explicit authorization scopes.

This is the canonical foundation for multi-contractor projects. The legacy
``Project.contractor_id`` remains the optional lead/general contractor during
migration; independent contractor principals live here and must be granted
resource scope explicitly before domain routes may expose data to them.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


PARTICIPANT_ROLES = frozenset({"lead_contractor", "contractor"})
PARTICIPANT_STATUSES = frozenset({"active", "removed"})
SCOPE_TYPES = frozenset({"stage", "room", "work_type"})
PARTICIPANT_EVENT_TYPES = frozenset(
    {"backfilled_lead", "added", "scope_replaced", "removed", "reactivated"}
)


class ProjectParticipant(Base):
    __tablename__ = "project_participants"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_participant_user"),
        CheckConstraint(
            "participant_role IN ('lead_contractor','contractor')",
            name="ck_project_participants_role",
        ),
        CheckConstraint(
            "status IN ('active','removed')",
            name="ck_project_participants_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    participant_role: Mapped[str] = mapped_column(String(32), default="contractor")
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    all_scope: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_schedule: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_commercial: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_documents: Mapped[bool] = mapped_column(Boolean, default=False)
    added_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    removed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ProjectParticipantScope(Base):
    __tablename__ = "project_participant_scopes"
    __table_args__ = (
        UniqueConstraint(
            "participant_id",
            "scope_type",
            "scope_ref",
            name="uq_project_participant_scope",
        ),
        CheckConstraint(
            "scope_type IN ('stage','room','work_type')",
            name="ck_project_participant_scopes_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_participants.id"), index=True
    )
    scope_type: Mapped[str] = mapped_column(String(16), index=True)
    scope_ref: Mapped[str] = mapped_column(String(64), index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ProjectParticipantEvent(Base):
    """Append-only audit trail for participant lifecycle and scope changes."""

    __tablename__ = "project_participant_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('backfilled_lead','added','scope_replaced','removed','reactivated')",
            name="ck_project_participant_events_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_participants.id"), index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
