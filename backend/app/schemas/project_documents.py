"""Pydantic schemas for canonical documents."""
from pydantic import BaseModel, Field


class DocumentCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    document_type: str = "upload"
    stage_id: str | None = None
    payment_id: str | None = None
    notes: str | None = None
    href: str | None = None
    storage_key: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    checksum_sha256: str | None = None


class DocumentVersionIn(BaseModel):
    href: str | None = None
    storage_key: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    checksum_sha256: str | None = None
    notes: str | None = None


class DocumentSignIn(BaseModel):
    signature_type: str = "in_app"
    content_hash: str | None = None


class LegalHoldIn(BaseModel):
    """Wave 3: включить/снять legal hold на документе."""
    enabled: bool = True
    retention_until: str | None = None  # ISO datetime optional
