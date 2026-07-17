from datetime import date
from pydantic import BaseModel, Field


class RoomInput(BaseModel):
    name: str
    room_type: str | None = None
    floor_level: int = Field(default=1, ge=-2, le=20)
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(default=2.7, gt=0)
    openings_sq_m: float = Field(default=2, ge=0)
    outlets_count: int = Field(default=0, ge=0)
    switches_count: int = Field(default=0, ge=0)
    plumbing_points: int = Field(default=0, ge=0)
    notes: str | None = None
    budget_alert_pct: float | None = None


class RoomUpdate(BaseModel):
    name: str | None = None
    room_type: str | None = None
    floor_level: int | None = Field(default=None, ge=-2, le=20)
    length_m: float | None = Field(default=None, gt=0)
    width_m: float | None = Field(default=None, gt=0)
    height_m: float | None = Field(default=None, gt=0)
    openings_sq_m: float | None = Field(default=None, ge=0)
    outlets_count: int | None = Field(default=None, ge=0)
    switches_count: int | None = Field(default=None, ge=0)
    plumbing_points: int | None = Field(default=None, ge=0)
    notes: str | None = None
    budget_alert_pct: float | None = None
    is_archived: bool | None = None




class ProjectUpdate(BaseModel):
    """Редактируемый профиль проекта — без пересчёта комнат/сметы."""
    name: str | None = None
    address: str | None = None
    renovation_type: str | None = None
    property_type: str | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None

class ProjectCreate(BaseModel):
    name: str
    address: str | None = None
    renovation_type: str = "cosmetic"
    property_type: str = "apartment"
    total_area_sqm: float | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    rooms: list[RoomInput] = Field(min_length=1)


class EstimateLineOut(BaseModel):
    id: str
    line_type: str
    name: str
    unit: str
    quantity_planned: float
    quantity_actual: float
    unit_price: float
    room_name: str | None
    room_id: str | None = None
    category: str | None = None
    calc_detail: str | None = None
    total: float


class StageOut(BaseModel):
    id: str
    name: str
    sort_order: int
    status: str
    percent_complete: float
    payment_amount: float
    weight_coefficient: float = 0
    planned_start: str | None = None
    planned_end: str | None = None
    contractor_ready: bool = False
    customer_accepted_at: str | None = None
    needs_rework: bool = False
    rework_deadline: str | None = None
    work_type: str | None = None
    room_ids: list[str] = []
    assignee_id: str | None = None
    actual_start: str | None = None
    actual_end: str | None = None
    display_status: str | None = None
    works_total: int = 0
    works_done: int = 0


class RoomOut(BaseModel):
    budget_alert_pct: float | None = None
    id: str
    name: str
    room_type: str | None
    floor_level: int = 1
    length_m: float
    width_m: float
    height_m: float
    openings_sq_m: float
    outlets_count: int
    switches_count: int
    plumbing_points: int
    notes: str | None
    floor_sq_m: float
    wall_sq_m: float
    perimeter_m: float
    is_archived: bool = False


class PaymentCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    payment_type: str
    stage_id: str | None = None
    notes: str | None = None


class PaymentOut(BaseModel):
    id: str
    title: str
    amount: float
    payment_type: str
    status: str
    stage_id: str | None
    notes: str | None
    confirmed_at: str | None
    created_at: str
    receipt_id: str | None = None


class StageCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class StagePhotoIn(BaseModel):
    image_data: str | None = None
    storage_key: str | None = None
    image_url: str | None = None
    caption: str | None = None


class StageDatesIn(BaseModel):
    planned_start: date | None = None
    planned_end: date | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    address: str | None
    renovation_type: str
    property_type: str = "apartment"
    budget_planned: float
    budget_spent: float
    progress_percent: float
    rooms_count: int
    stages_count: int
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    pending_payments: int | None = None


class ProjectDetail(ProjectOut):
    read_only: bool = False
    access_mode: str = "owner"  # owner | contractor | guest
    estimate_lines: list[EstimateLineOut]
    stages: list[StageOut]
    rooms: list[RoomOut] = []


class YookassaCheckoutOut(BaseModel):
    demo: bool = False
    payment_id: str | None = None
    yookassa_payment_id: str | None = None
    confirmation_url: str | None = None
    status: str | None = None
    error: str | None = None
    message: str | None = None
