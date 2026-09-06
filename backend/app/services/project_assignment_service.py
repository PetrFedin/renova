"""Canonical serialized assignment of the current lead contractor."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Project
from app.services import project_participant_service as participant_service
from app.services.subscription_service import is_pro

AssignmentStatus = Literal[
    "assigned",
    "not_found",
    "already_assigned",
    "subscription_required",
]


@dataclass(frozen=True)
class AssignmentResult:
    status: AssignmentStatus
    project: Project | None = None
    current_contractor_id: str | None = None


async def _loaded_project(db: AsyncSession, project_id: str) -> Project | None:
    from app.services.project_service import get_project

    return await get_project(db, project_id)


async def _project_count(db: AsyncSession, contractor_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.contractor_id == contractor_id)
        )
        or 0
    )


async def assign_contractor(
    db: AsyncSession,
    *,
    project_id: str,
    contractor_id: str,
    actor_id: str | None,
) -> AssignmentResult:
    """Assign exactly one current lead under a project-row lock.

    The row lock serializes different contractors racing for an unassigned
    project. ``Project.contractor_id`` and the canonical lead participant/event
    are committed together by ``sync_current_lead_in_transaction``.
    """
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    project = (await db.execute(query)).scalar_one_or_none()
    if project is None:
        await db.rollback()
        return AssignmentResult(status="not_found")

    current = project.contractor_id
    if current and current != contractor_id:
        await db.rollback()
        return AssignmentResult(
            status="already_assigned",
            current_contractor_id=current,
        )

    if current != contractor_id:
        count = await _project_count(db, contractor_id)
        if count >= settings.contractor_free_project_limit and not await is_pro(db, contractor_id):
            await db.rollback()
            return AssignmentResult(status="subscription_required")

    try:
        await participant_service.sync_current_lead_in_transaction(
            db,
            project=project,
            contractor_id=contractor_id,
            actor_id=actor_id,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    loaded = await _loaded_project(db, project_id)
    if loaded is None:
        raise ValueError("project_assignment_entity_missing")
    return AssignmentResult(
        status="assigned",
        project=loaded,
        current_contractor_id=contractor_id,
    )
