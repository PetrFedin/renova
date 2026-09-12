"""Project-scoped stage date mutation used by calendar routes.

Security invariant: a child Stage is proven to belong to the authorized project
before any date/ical mutation is applied or committed.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Stage


async def update_stage_dates(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    start: date | None,
    end: date | None,
) -> Stage | None:
    result = await db.execute(
        select(Stage).where(
            Stage.id == stage_id,
            Stage.project_id == project_id,
        )
    )
    stage = result.scalar_one_or_none()
    if stage is None:
        return None
    if start:
        stage.planned_start = start
    if end:
        stage.planned_end = end
    if not getattr(stage, "ical_uid", None):
        stage.ical_uid = f"renova-{stage.id}@app"
    await db.commit()
    await db.refresh(stage)
    return stage
