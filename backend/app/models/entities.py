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
