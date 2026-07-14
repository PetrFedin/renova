"""Canonical project documents (D-01…D-03)."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class DocumentType(str, enum.Enum):
    acceptance_act = "acceptance_act"
    design_package = "design_package"
    receipt = "receipt"
    estimate = "estimate"
    contract = "contract"
    invoice = "invoice"
    warranty = "warranty"
    upload = "upload"
    other = "other"


class DocumentStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    superseded = "superseded"
    archived = "archived"
    deleted = "deleted"


class ProjectDocument(Base):
    """Единая сущность документа проекта."""

    __tablename__ = "project_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), index=True)
    stage_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stages.id"), nullable=True, index=True)
    payment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payments.id"), nullable=True, index=True)
    receipt_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("receipts.id"), nullable=True)
    work_acceptance_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("work_acceptances.id"), nullable=True, index=True
    )
    document_type: Mapped[str] = mapped_column(String(32), index=True, default=DocumentType.other.value)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), index=True, default=DocumentStatus.active.value)
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Wave 3: legal hold блокирует soft-delete; retention_until — дата снятия холда (ISO day)
    legal_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class DocumentVersion(Base):
    """Версия файла документа."""

    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("project_documents.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    href: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Wave 3b: OCR classify stub (async-ready flags; sync runner in MVP)
    ocr_status: Mapped[str] = mapped_column(String(16), default="none")  # none|queued|processing|done|failed
    ocr_job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ocr_suggested_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ocr_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ocr_error: Mapped[str | None] = mapped_column(String(255), nullable=True)


class DocumentSignature(Base):
    """Подпись версии документа (MVP stub — без внешнего провайдера)."""

    __tablename__ = "document_signatures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("project_documents.id"), index=True)
    version_id: Mapped[str] = mapped_column(String(36), ForeignKey("document_versions.id"), index=True)
    signer_user_id: Mapped[str] = mapped_column(String(36), index=True)
    signer_role: Mapped[str] = mapped_column(String(32), default="customer")
    signature_type: Mapped[str] = mapped_column(String(32), default="in_app")
    provider_name: Mapped[str] = mapped_column(String(32), default="in_app")
    provider_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="signed")
    signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
