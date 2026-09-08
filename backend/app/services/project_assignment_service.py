"""Canonical serialized assignment of the current lead contractor."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Project, User, UserRole
from app.services import project_participant_service as participant_service
from app.services.subscription_service import is_pro

AssignmentStatus = Literal[
    "assigned", "not_found", "already_assigned", "subscription_required",
    "forbidden", "project_trashed", "contractor_invalid",
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
            select(func.count()).select_from(Project)
            .where(Project.contractor_id == contractor_id)
        ) or 0
    )


async def assign_contractor(
    db: AsyncSession,
    *,
    project_id: str,
    contractor_id: str,
    actor_id: str | None,
) -> AssignmentResult:
    """Assign one lead using freshly locked state, never a preloaded ORM snapshot.

    A customer link request may already have loaded Project before waiting for
    this lock. populate_existing is essential: acquiring a database lock alone
    does not replace stale attributes in SQLAlchemy's identity map. Actor/target
    validation and lifecycle checks also happen inside this transaction.
    actor_id=None is reserved for trusted internal compatibility callers.
    """
    try:
        project = await db.scalar(
            select(Project).where(Project.id == project_id)
            .with_for_update().execution_options(populate_existing=True)
        )
        if project is None:
            await db.rollback()
            return AssignmentResult(status="not_found")
        if project.trashed_at is not None:
            await db.rollback()
            return AssignmentResult(status="project_trashed")

        if actor_id is not None:
            actor = await db.get(User, actor_id, populate_existing=True)
            is_owner = bool(
                actor is not None and actor.deleted_at is None
                and actor.role == UserRole.customer and actor.id == project.customer_id
            )
            is_self_claim = bool(
                actor is not None and actor.deleted_at is None
                and actor.role == UserRole.contractor and actor.id == contractor_id
            )
            if not (is_owner or is_self_claim):
                await db.rollback()
                return AssignmentResult(status="forbidden")

        current = project.contractor_id
        if current and current != contractor_id:
            await db.rollback()
            return AssignmentResult(status="already_assigned", current_contractor_id=current)

        target = await db.get(User, contractor_id, populate_existing=True)
        if target is None or target.role != UserRole.contractor or target.deleted_at is not None:
            await db.rollback()
            return AssignmentResult(status="contractor_invalid")

        if current != contractor_id:
            count = await _project_count(db, contractor_id)
            if count >= settings.contractor_free_project_limit and not await is_pro(db, contractor_id):
                await db.rollback()
                return AssignmentResult(status="subscription_required")

        await participant_service.sync_current_lead_in_transaction(
            db, project=project, contractor_id=contractor_id, actor_id=actor_id,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    loaded = await _loaded_project(db, project_id)
    if loaded is None:
        raise ValueError("project_assignment_entity_missing")
    return AssignmentResult(status="assigned", project=loaded, current_contractor_id=contractor_id)
