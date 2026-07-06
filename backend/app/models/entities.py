"""ORM-модели Renova v1.4."""
import enum
import uuid
from datetime import date, datetime
from sqlalchemy import UniqueConstraint, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    customer = "customer"
    contractor = "contractor"


class StageStatus(str, enum.Enum):
    planned = "planned"
    active = "active"
    review = "review"
    done = "done"


class LineType(str, enum.Enum):
    material = "material"
    work = "work"


class PaymentType(str, enum.Enum):
    advance = "advance"
    stage = "stage"
    material = "material"
    final = "final"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled = "cancelled"


class ChangeOrderStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole))
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    moy_nalog_linked: Mapped[bool] = mapped_column(Boolean, default=False)
    profile_code: Mapped[str | None] = mapped_column(String(8), unique=True, nullable=True, index=True)
    npd_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    renovation_type: Mapped[str] = mapped_column(String(32))
    property_type: Mapped[str] = mapped_column(String(32), default="apartment")
    total_area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    contractor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    foreman_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    budget_planned: Mapped[float] = mapped_column(Float, default=0)
    budget_spent: Mapped[float] = mapped_column(Float, default=0)
    progress_percent: Mapped[float] = mapped_column(Float, default=0)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rooms: Mapped[list["Room"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    estimate_lines: Mapped[list["EstimateLine"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    stages: Mapped[list["Stage"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    change_orders: Mapped[list["ChangeOrder"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    receipts: Mapped[list["Receipt"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    chat_threads: Mapped[list["ChatThread"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    scratchpad_lines: Mapped[list["ScratchpadLine"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    room_change_requests: Mapped[list["RoomChangeRequest"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    floor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("property_floors.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    room_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    floor_level: Mapped[int] = mapped_column(Integer, default=1)
    length_m: Mapped[float] = mapped_column(Float)
    width_m: Mapped[float] = mapped_column(Float)
    height_m: Mapped[float] = mapped_column(Float, default=2.7)
    openings_sq_m: Mapped[float] = mapped_column(Float, default=2)
    outlets_count: Mapped[int] = mapped_column(Integer, default=0)
    switches_count: Mapped[int] = mapped_column(Integer, default=0)
    plumbing_points: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    budget_alert_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped["Project"] = relationship(back_populates="rooms")


class EstimateLine(Base):
    __tablename__ = "estimate_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    line_type: Mapped[LineType] = mapped_column(Enum(LineType))
    name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(16))
    quantity_planned: Mapped[float] = mapped_column(Float)
    quantity_actual: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Float)
    room_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    calc_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="estimate_lines")


class Stage(Base):
    __tablename__ = "stages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[StageStatus] = mapped_column(Enum(StageStatus), default=StageStatus.planned)
    percent_complete: Mapped[float] = mapped_column(Float, default=0)
    payment_amount: Mapped[float] = mapped_column(Float, default=0)
    weight_coefficient: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    contractor_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    contractor_ready_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    customer_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    needs_rework: Mapped[bool] = mapped_column(Boolean, default=False)
    ical_uid: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    rework_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    work_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    depends_on_stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    room_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    checklist_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    actual_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="stages")
    comments: Mapped[list["StageComment"]] = relationship(back_populates="stage", cascade="all, delete-orphan")
    photos: Mapped[list["StagePhoto"]] = relationship(back_populates="stage", cascade="all, delete-orphan")


class StageComment(Base):
    __tablename__ = "stage_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    stage_id: Mapped[str] = mapped_column(String(36), ForeignKey("stages.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    author_role: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    stage: Mapped["Stage"] = relationship(back_populates="comments")


class StagePhoto(Base):
    __tablename__ = "stage_photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    stage_id: Mapped[str] = mapped_column(String(36), ForeignKey("stages.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    image_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # fallback base64
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    stage: Mapped["Stage"] = relationship(back_populates="photos")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    payment_type: Mapped[PaymentType] = mapped_column(Enum(PaymentType))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.pending)
    title: Mapped[str] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="payments")


class ChangeOrder(Base):
    __tablename__ = "change_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[ChangeOrderStatus] = mapped_column(Enum(ChangeOrderStatus), default=ChangeOrderStatus.pending)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="change_orders")


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    amount: Mapped[float] = mapped_column(Float)
    qr_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    fn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fd: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fns_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    expense_category: Mapped[str] = mapped_column(String(32), default="materials")
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    payment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payments.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="receipts")



class ProjectViewer(Base):
    __tablename__ = "project_viewers"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_viewer"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RoomChangeStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class ChatMessageType(str, enum.Enum):
    text = "text"
    photo = "photo"
    file = "file"
    confirm = "confirm"
    system = "system"
    task = "task"
    invoice = "invoice"
    payment = "payment"


class NotificationType(str, enum.Enum):
    stage_review = "stage_review"
    room_updated = "room_updated"
    payment_pending = "payment_pending"
    change_order = "change_order"
    room_change = "room_change"
    chat_message = "chat_message"
    budget_alert = "budget_alert"
    reaction = "reaction"

class RoomChangeRequest(Base):
    __tablename__ = "room_change_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"))
    requested_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    status: Mapped[RoomChangeStatus] = mapped_column(Enum(RoomChangeStatus), default=RoomChangeStatus.pending)
    message: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="room_change_requests")


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(255))
    topic: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="chat_threads")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="thread", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(String(36), ForeignKey("chat_threads.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    author_role: Mapped[str] = mapped_column(String(16))
    message_type: Mapped[ChatMessageType] = mapped_column(Enum(ChatMessageType), default=ChatMessageType.text)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    confirmed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_to_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chat_messages.id"), nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    thread: Mapped["ChatThread"] = relationship(back_populates="messages")


class AppNotification(Base):
    __tablename__ = "app_notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True)
    notification_type: Mapped[NotificationType] = mapped_column(Enum(NotificationType))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    link_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RepairArticle(Base):
    __tablename__ = "repair_articles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32), index=True)
    tags: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_min: Mapped[int] = mapped_column(Integer, default=3)
    summary: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PushToken(Base):
    __tablename__ = "push_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class SubscriptionStatus(str, enum.Enum):
    free = "free"
    active = "active"

class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    status: Mapped[SubscriptionStatus] = mapped_column(Enum(SubscriptionStatus), default=SubscriptionStatus.free)
    plan: Mapped[str] = mapped_column(String(32), default="free")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChatThreadRead(Base):
    """Отметка прочтения чата пользователем."""
    __tablename__ = "chat_thread_reads"
    __table_args__ = (UniqueConstraint("user_id", "thread_id", name="uq_chat_read"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    thread_id: Mapped[str] = mapped_column(String(36), ForeignKey("chat_threads.id"), index=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChatThreadParticipant(Base):
    __tablename__ = "chat_thread_participants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(String(36), ForeignKey("chat_threads.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    profile_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    invited_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(512))
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(128))
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team", cascade="all, delete-orphan")


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    team: Mapped["Team"] = relationship(back_populates="members")


class TeamInvite(Base):
    __tablename__ = "team_invites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ChecklistTemplate(Base):
    __tablename__ = "checklist_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    items_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BudgetAlertSent(Base):
    __tablename__ = "budget_alert_sent"
    __table_args__ = (UniqueConstraint("user_id", "room_id", "sent_date", name="uq_budget_alert_day"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    sent_date: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChecklistTemplateVersion(Base):
    __tablename__ = "checklist_template_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    template_id: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[str] = mapped_column(String(16), default="user")
    name: Mapped[str] = mapped_column(String(64))
    items_json: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CommentReaction(Base):
    __tablename__ = "comment_reactions"
    __table_args__ = (UniqueConstraint("comment_id", "user_id", name="uq_comment_react"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    comment_id: Mapped[str] = mapped_column(String(36), ForeignKey("stage_comments.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    reaction: Mapped[str] = mapped_column(String(8))


class RoomChangeLog(Base):
    __tablename__ = "room_change_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    field_name: Mapped[str] = mapped_column(String(64))
    old_value: Mapped[str] = mapped_column(String(255))
    new_value: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MarginSnapshot(Base):
    __tablename__ = "margin_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    margin_estimated: Mapped[float] = mapped_column(Float, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ProjectChecklistTemplate(Base):
    __tablename__ = "project_checklist_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    items_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)




class PurchaseStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    ordered = "ordered"
    paid = "paid"
    partial = "partial"
    delivered = "delivered"
    cancelled = "cancelled"
    returned = "returned"


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    site: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Purchase(Base):
    __tablename__ = "purchases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    supplier_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("suppliers.id"), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[PurchaseStatus] = mapped_column(Enum(PurchaseStatus), default=PurchaseStatus.draft)
    total_amount: Mapped[float] = mapped_column(Float, default=0)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    receipt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    items: Mapped[list["PurchaseItem"]] = relationship(back_populates="purchase", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    purchase_id: Mapped[str] = mapped_column(String(36), ForeignKey("purchases.id"), index=True)
    material_pick_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("material_picks.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    qty: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(16), default="шт")
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    room_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    purchase: Mapped["Purchase"] = relationship(back_populates="items")

class MaterialPickStatus(str, enum.Enum):
    draft = "draft"
    pending = "pending"
    approved = "approved"
    purchased = "purchased"


class MaterialPick(Base):
    __tablename__ = "material_picks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    qty: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(16), default="шт")
    price: Mapped[float] = mapped_column(Float, default=0)
    shop_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    shop_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    work_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    qty_needed: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty_delivered: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[MaterialPickStatus] = mapped_column(Enum(MaterialPickStatus), default=MaterialPickStatus.draft)
    analog_of_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("material_picks.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    work_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    link_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class WasteOrderStatus(str, enum.Enum):
    draft = "draft"
    requested = "requested"
    scheduled = "scheduled"
    done = "done"
    cancelled = "cancelled"


class FloorPlan(Base):
    __tablename__ = "floor_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(128), default="Планировка")
    image_key: Mapped[str] = mapped_column(String(512))
    width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floor_level: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FloorPlanPin(Base):
    __tablename__ = "floor_plan_pins"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    floor_plan_id: Mapped[str] = mapped_column(String(36), ForeignKey("floor_plans.id"), index=True)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    x_pct: Mapped[float] = mapped_column(Float, default=50)
    y_pct: Mapped[float] = mapped_column(Float, default=50)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WasteOrder(Base):
    __tablename__ = "waste_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True, index=True)
    volume_m3: Mapped[float] = mapped_column(Float, default=1)
    waste_type: Mapped[str] = mapped_column(String(64), default="construction")
    scheduled_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[WasteOrderStatus] = mapped_column(Enum(WasteOrderStatus), default=WasteOrderStatus.draft)
    price: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FurnitureItem(Base):
    __tablename__ = "furniture_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True, index=True)
    floor_plan_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("floor_plans.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    width_m: Mapped[float] = mapped_column(Float, default=0.6)
    depth_m: Mapped[float] = mapped_column(Float, default=0.6)
    height_m: Mapped[float] = mapped_column(Float, default=0.8)
    x_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    y_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DesignPackage(Base):
    __tablename__ = "design_packages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    version: Mapped[int] = mapped_column(Integer, default=1)
    file_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ContractorProfile(Base):
    __tablename__ = "contractor_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, index=True)
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    specialties: Mapped[str | None] = mapped_column(String(512), nullable=True)
    rating: Mapped[float] = mapped_column(Float, default=5.0)
    jobs_done: Mapped[int] = mapped_column(Integer, default=0)
    city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class JobLeadStatus(str, enum.Enum):
    open = "open"
    quoted = "quoted"
    taken = "taken"
    closed = "closed"


class JobLead(Base):
    __tablename__ = "job_leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    renovation_type: Mapped[str] = mapped_column(String(32), default="cosmetic")
    budget_hint: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[JobLeadStatus] = mapped_column(Enum(JobLeadStatus), default=JobLeadStatus.open)
    pre_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
    assigned_contractor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ContractorPortfolioPhoto(Base):
    __tablename__ = "contractor_portfolio_photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(String(36), ForeignKey("contractor_profiles.id"), index=True)
    image_key: Mapped[str] = mapped_column(String(512))
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class LeadMessage(Base):
    __tablename__ = "lead_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("job_leads.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class IssueSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class IssueStatus(str, enum.Enum):
    open = "open"
    assigned = "assigned"
    in_progress = "in_progress"
    fixed = "fixed"
    review = "review"
    closed = "closed"
    rejected = "rejected"


class ProjectIssue(Base):
    """Замечание / дефект Renova OS."""
    __tablename__ = "project_issues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    assignee_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class DependencyType(str, enum.Enum):
    work = "work"
    material = "material"
    payment = "payment"
    acceptance = "acceptance"
    document = "document"


class DependencyStatus(str, enum.Enum):
    pending = "pending"
    satisfied = "satisfied"
    blocked = "blocked"


class WorkDependency(Base):
    """Зависимость работы: этап / материал / оплата / приёмка."""
    __tablename__ = "work_dependencies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(36), ForeignKey("stages.id"), index=True)
    depends_on_stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    depends_on_material_pick_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("material_picks.id"), nullable=True)
    dependency_type: Mapped[str] = mapped_column(String(16), default="work")
    criticality: Mapped[str] = mapped_column(String(16), default="high")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PropertyFloor(Base):
    """Этаж объекта ремонта (дом, дуплекс)."""
    __tablename__ = "property_floors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    floor_number: Mapped[int] = mapped_column(Integer, default=1)
    area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PropertyObject(Base):
    """Паспорт объекта ремонта — расширение проекта."""
    __tablename__ = "property_objects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), unique=True, index=True)
    object_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    total_area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    floors_count: Mapped[int] = mapped_column(Integer, default=1)
    rooms_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ceiling_height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    build_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    building_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    has_elevator: Mapped[bool] = mapped_column(Boolean, default=False)
    condition_before: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_new_build: Mapped[bool] = mapped_column(Boolean, default=False)
    has_demolition: Mapped[bool] = mapped_column(Boolean, default=False)
    has_replanning: Mapped[bool] = mapped_column(Boolean, default=False)
    has_design_project: Mapped[bool] = mapped_column(Boolean, default=False)
    has_contractor: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class AcceptanceStatus(str, enum.Enum):
    not_requested = "not_requested"
    requested = "requested"
    in_review = "in_review"
    accepted = "accepted"
    accepted_with_remarks = "accepted_with_remarks"
    returned = "returned"
    rejected = "rejected"


class WorkAcceptance(Base):
    """Процесс приёмки этапа Renova OS."""
    __tablename__ = "work_acceptances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    stage_id: Mapped[str] = mapped_column(String(36), ForeignKey("stages.id"), index=True)
    requested_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    accepted_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="not_requested", index=True)
    checklist_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExpenseStatus(str, enum.Enum):
    draft = "draft"
    confirmed = "confirmed"
    pending_receipt = "pending_receipt"
    disputed = "disputed"
    refund = "refund"
    deleted = "deleted"


class BudgetLine(Base):
    """Строка бюджета: план vs факт по категории/комнате/работе."""
    __tablename__ = "budget_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    estimate_line_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("estimate_lines.id"), nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="other")
    description: Mapped[str] = mapped_column(String(255))
    planned_amount: Mapped[float] = mapped_column(Float, default=0)
    actual_amount: Mapped[float] = mapped_column(Float, default=0)
    expense_type: Mapped[str] = mapped_column(String(32), default="materials")
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Expense(Base):
    """Единый расход: чек, ручной ввод, закупка, оплата подрядчику."""
    __tablename__ = "expenses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True)
    material_pick_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    receipt_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("receipts.id"), nullable=True)
    payment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payments.id"), nullable=True)
    purchase_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32), default="materials")
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="RUB")
    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="confirmed", index=True)
    expense_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)



class WorkOrderStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    negotiating = "negotiating"
    approved = "approved"
    in_progress = "in_progress"
    review = "review"
    done = "done"
    paid = "paid"
    cancelled = "cancelled"


class WorkOrder(Base):
    """Детальная работа: комната × тип × дата × статус × бюджет × чат."""
    __tablename__ = "work_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rooms.id"), nullable=True, index=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True, index=True)
    work_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[WorkOrderStatus] = mapped_column(Enum(WorkOrderStatus), default=WorkOrderStatus.draft)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    assignee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    chat_thread_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chat_threads.id"), nullable=True)
    budget_planned: Mapped[float] = mapped_column(Float, default=0)
    budget_spent: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="work_orders")


class ScratchpadLine(Base):
    """Черновик проекта — свободные строки, чеклисты, списки покупок."""
    __tablename__ = "scratchpad_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    line_kind: Mapped[str] = mapped_column(String(32), default="note")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    promoted_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    promoted_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="scratchpad_lines")
