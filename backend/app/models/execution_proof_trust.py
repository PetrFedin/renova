"""ORM mapping for persistent portable execution-proof revocations."""
from datetime import datetime

from sqlalchemy import DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExecutionProofRevocation(Base):
    __tablename__ = "execution_proof_revocations"

    checkpoint_sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    revoked_by: Mapped[str] = mapped_column(String(64), nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_execution_proof_revocations_revoked_at", "revoked_at"),
    )
