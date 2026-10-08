from datetime import date
from typing import Literal
from pydantic import BaseModel, Field, model_validator


class RoomInput(BaseModel):
    name: str
    room_type: str | None = None
    floor_level: int = Field(default=1, ge=-2, le=20)
    length_m: float = Field(gt=0, le=100)
    width_m: float = Field(gt=0, le=100)
    height_m: float = Field(default=2.7, gt=0, le=10)
    openings_sq_m: float = Field(default=2, ge=0, le=500)
    outlets_count: int = Field(default=0, ge=0, le=1000)
    switches_count: int = Field(default=0, ge=0, le=1000)
    plumbing_points: int = Field(default=0, ge=0, le=1000)
    notes: str | None = None
    budget_alert_pct: float | None = None


class RoomUpdate(BaseModel):
    name: str | None = None
    room_type: str | None = None
    floor_level: int | None = Field(default=None, ge=-2, le=20)
    length_m: float | None = Field(default=None, gt=0, le=100)
    width_m: float | None = Field(default=None, gt=0, le=100)
    height_m: float | None = Field(default=None, gt=0, le=10)
    openings_sq_m: float | None = Field(default=None, ge=0, le=500)
    outlets_count: int | None = Field(default=None, ge=0, le=1000)
    switches_count: int | None = Field(default=None, ge=0, le=1000)
    plumbing_points: int | None = Field(default=None, ge=0, le=1000)
    notes: str | None = None
    budget_alert_pct: float | None = None
    is_archived: bool | None = None


class ProjectUpdate(BaseModel):
    """Редактируемый профиль проекта — без пересчёта комнат/сметы."""
    name: str | None = None
    vat_rate: Literal[0, 5, 10, 20] | None = None
    address: str | None = None
    renovation_type: str | None = None
    property_type: str | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    customer_budget: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        # Explicit null must not reach NOT NULL project columns and become a 500.
        # Omitted fields remain a valid partial PATCH.
        for field_name in ("name", "renovation_type", "property_type"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


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
    # EST-001: True when the estimate is locked and this edit did not recalc lines/budget.
    estimate_frozen: bool = False


class PaymentCreate(BaseModel):
    title: str
    amount: float | None = Field(default=None, gt=0)
    """W68/W69 #40: доля этапа 1–100%; если задана — amount считается от stage.payment_amount."""
    percent: float | None = Field(default=None, gt=0, le=100)
    payment_type: str
    stage_id: str | None = None
    notes: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class PaymentEventOut(BaseModel):
    id: str
    old_status: str
    new_status: str
    source: str
    evidence_type: str | None = None
    note: str | None = None
    actor_label: str
    created_at: str


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
    # BUD-19: приложен чек, но ФНС его не проверяла (счёт он при этом подтверждает).
    receipt_unverified: bool = False
    events: list[PaymentEventOut] = Field(default_factory=list)


class StageCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    client_request_id: str | None = Field(default=None, max_length=80)


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
    customer_budget: float | None = None
    # Происхождение объекта (заявка биржи, цена принятого КП): владельцу и исполнителю.
    notes: str | None = None
    progress_percent: float
    vat_rate: float = 0
    rooms_count: int
    stages_count: int
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    pending_payments: int | None = None
    is_archived: bool = False
    trashed_at: str | None = None
    estimate_locked_at: str | None = None
    estimate_lock_proposed_at: str | None = None
    estimate_lock_proposed_by: str | None = None
    # Подключённый (ведущий) исполнитель: только владельцу и исполнителю; гостю, технадзору
    # и независимому участнику не отдаётся. Mobile по нему отличает «исполнитель назначен».
    contractor_id: str | None = None
    # owner | contractor | guest | supervisor | none — archive/trash только для owner
    access_mode: str = "owner"
    # Legacy supervisor-specific capability surface kept for compatibility.
    technical_capabilities: list[str] = Field(default_factory=list)
    # Canonical UX responsibility projection. Authorization remains enforced
    # by server-side domain policies; clients use this only to shape actions.
    operational_persona: Literal[
        "owner", "lead", "foreman", "member", "participant", "supervisor", "guest"
    ] = "guest"
    capabilities: list[str] = Field(default_factory=list)


class ProjectDetail(ProjectOut):
    read_only: bool = False
    estimate_lines: list[EstimateLineOut]
    stages: list[StageOut]
    rooms: list[RoomOut] = []


class YookassaCheckoutIn(BaseModel):
    portal_token: str | None = None


class YookassaCheckoutOut(BaseModel):
    demo: bool = False
    payment_id: str | None = None
    yookassa_payment_id: str | None = None
    confirmation_url: str | None = None
    status: str | None = None
    error: str | None = None
    message: str | None = None
