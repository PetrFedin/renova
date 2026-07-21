from datetime import date, datetime
from pydantic import BaseModel, Field

from app.models.work_schedule import WorkScheduleItemStatus, WorkScheduleStatus


class WorkScheduleItemIn(BaseModel):
    stage_id: str | None = None
    title: str = Field(min_length=2, max_length=255)
    description: str | None = None
    planned_start_date: date
    planned_finish_date: date
    depends_on_item_id: str | None = None
    requires_customer_acceptance: bool = True
    requires_photo: bool = True
    requires_hidden_work_acceptance: bool = False
    sort_order: int = 0


class WorkScheduleCreateIn(BaseModel):
    title: str = "План-график работ"
    description: str | None = None
    planned_start_date: date | None = None
    planned_finish_date: date | None = None
    items: list[WorkScheduleItemIn] = []


class WorkScheduleUpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    planned_start_date: date | None = None
    planned_finish_date: date | None = None
    items: list[WorkScheduleItemIn] | None = None


class WorkScheduleRejectIn(BaseModel):
    reason: str | None = None


class WorkScheduleItemStatusIn(BaseModel):
    status: WorkScheduleItemStatus
    blocking_reason: str | None = None
    progress_percent: float | None = Field(default=None, ge=0, le=100)


class WorkScheduleItemOut(BaseModel):
    id: str
    schedule_id: str
    project_id: str
    stage_id: str | None = None
    title: str
    description: str | None = None
    status: WorkScheduleItemStatus
    planned_start_date: date
    planned_finish_date: date
    actual_start_date: date | None = None
    actual_finish_date: date | None = None
    depends_on_item_id: str | None = None
    requires_customer_acceptance: bool
    requires_photo: bool
    requires_hidden_work_acceptance: bool
    delay_days: int
    blocking_reason: str | None = None
    sort_order: int
    progress_percent: float
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class WorkScheduleOut(BaseModel):
    id: str
    project_id: str
    status: WorkScheduleStatus
    title: str
    description: str | None = None
    planned_start_date: date | None = None
    planned_finish_date: date | None = None
    schedule_version: int = 1
    supersedes_id: str | None = None
    rejection_reason: str | None = None
    created_by: str
    submitted_by: str | None = None
    confirmed_by: str | None = None
    rejected_by: str | None = None
    created_at: datetime
    submitted_at: datetime | None = None
    confirmed_at: datetime | None = None
    rejected_at: datetime | None = None
    updated_at: datetime
    items: list[WorkScheduleItemOut] = []

    class Config:
        from_attributes = True
