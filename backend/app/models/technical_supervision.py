from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ProjectTechnicalSupervisorAssignment(Base):
    __tablename__ = "project_technical_supervisor_assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    representative_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    provider_type: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    appointed_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    appointed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revoked_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    supersedes_assignment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_technical_supervisor_assignments.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "provider_type IN ('individual', 'company')",
            name="ck_project_technical_supervisor_provider_type",
        ),
        Index(
            "ix_project_tech_supervisor_rep_user",
            "representative_user_id",
        ),
        Index(
            "ux_project_technical_supervisor_active_project",
            "project_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
        Index(
            "ix_project_technical_supervisor_rep_active",
            "representative_user_id",
            "revoked_at",
        ),
    )
