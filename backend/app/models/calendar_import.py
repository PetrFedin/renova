"""Result ledger for atomic, response-loss-safe iCalendar imports (#422).

`IcalImportResult` stores the outcome of one import attempt so a replayed
request (same `ClientWriteRequest` ledger row) can return the original
result verbatim instead of re-parsing/re-mapping the file. The row is the
`entity_id` target referenced by the `calendar.import` scope in
`client_write_requests`.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class IcalImportResult(Base):
    __tablename__ = "ical_import_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    parsed: Mapped[int] = mapped_column(Integer, default=0)
    updated_stages: Mapped[int] = mapped_column(Integer, default=0)
    mapping_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
