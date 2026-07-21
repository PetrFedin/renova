"""Work schedule models for project timeline control."""
from app.core.timeutil import utc_now
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class WorkScheduleStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    confirmed = "confirmed"
    rejected = "rejected"
    archived = "archived"


class WorkScheduleItemStatus(str, enum.Enum):
    planned = "planned"
    ready = "ready"
    in_progress = "in_progress"
    submitted = "submitted"
    accepted = "accepted"
    delayed = "delayed"
    blocked = "blocked"
    cancelled = "cancelled"


class ProjectWorkSchedule(Base):
    __tablename__ = "project_work_schedules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True, nullable=False)
    status: Mapped[WorkScheduleStatus] = mapped_column(
        Enum(WorkScheduleStatus), default=WorkScheduleStatus.draft, index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), default="План-график работ")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_finish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    submitted_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    rejected_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    # E5: monotonic version; supersedes_id → previous schedule row when re-issued after reject
    schedule_version: Mapped[int] = mapped_column(Integer, default=1)
    supersedes_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_work_schedules.id"), nullable=True, index=True
    )


class ProjectWorkScheduleItem(Base):
    __tablename__ = "project_work_schedule_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    schedule_id: Mapped[str] = mapped_column(String(36), ForeignKey("project_work_schedules.id"), index=True, nullable=False)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True, nullable=False)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[WorkScheduleItemStatus] = mapped_column(
        Enum(WorkScheduleItemStatus), default=WorkScheduleItemStatus.planned, index=True, nullable=False
    )
    planned_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    planned_finish_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_finish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    depends_on_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_work_schedule_items.id"), nullable=True, index=True
    )
    requires_customer_acceptance: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_photo: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_hidden_work_acceptance: Mapped[bool] = mapped_column(Boolean, default=False)
    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    blocking_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    progress_percent: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
