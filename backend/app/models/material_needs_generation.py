"""Result ledger for atomic, replay-safe estimate-to-material-needs generation (#419).

`MaterialNeedsGenerationResult` records the outcome of one
`generate_needs_from_estimate` attempt so a replayed request (same
`ClientWriteRequest` ledger row, scope `material_needs.generate`) can return
the original generated `MaterialPick` set verbatim instead of re-running the
estimate-line scan. The row is the `entity_id` target referenced by that
scope in `client_write_requests`, mirroring `IcalImportResult` (#422).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import _uuid


class MaterialNeedsGenerationResult(Base):
    __tablename__ = "material_needs_generation_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    created_pick_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
