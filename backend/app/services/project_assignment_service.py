"""Canonical serialized assignment of the current lead contractor."""
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import ContractorProfile, Project, User, UserRole
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


async def free_slot_exhausted(db: AsyncSession, contractor_id: str) -> bool:
    """True, когда исполнителю нельзя взять ещё один объект (лимит бесплатного тарифа).

    Единая проверка для назначения исполнителя и для конверсии заявки биржи
    (MKT-008/ROLE-013): путь «через заявку» не должен обходить монетизацию.
    """
    count = await _project_count(db, contractor_id)
    return count >= settings.contractor_free_project_limit and not await is_pro(db, contractor_id)


async def resolve_contractor_user_id(db: AsyncSession, contractor_ref: str) -> str:
    """Accept a user id or a ContractorProfile id (directory rows carry both).

    ROLE-006: the directory used to hand out ``profile.id`` and the client sent
    it straight to ``/contractor``, which only understood ``users.id``. A profile
    id is unambiguous (uuid), so the server maps it to the owning user instead of
    depending on every client passing the right one.
    """
    if await db.get(User, contractor_ref) is not None:
        return contractor_ref
    owner = await db.scalar(
        select(ContractorProfile.user_id).where(ContractorProfile.id == contractor_ref)
    )
    return owner or contractor_ref


async def assign_locked(
    db: AsyncSession,
    *,
    project: Project,
    contractor_id: str,
    actor_id: str | None,
) -> AssignmentStatus | None:
    """Validate and apply a lead assignment on an already locked project.

    Returns an error status, or ``None`` after the lead was synchronized. The
    caller owns the transaction (commit/rollback); this never commits.
    """
    current = project.contractor_id
    if current and current != contractor_id:
        return "already_assigned"

    target = await db.get(User, contractor_id, populate_existing=True)
    if target is None or target.role != UserRole.contractor or target.deleted_at is not None:
        return "contractor_invalid"

    if current != contractor_id:
        if await free_slot_exhausted(db, contractor_id):
            return "subscription_required"

    await participant_service.sync_current_lead_in_transaction(
        db, project=project, contractor_id=contractor_id, actor_id=actor_id,
    )
    return None


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

    Only the project's customer (or a trusted internal caller) may assign. A
    contractor's own wish to lead a project is a *request* the customer must
    confirm (see project_assignment_request_service), never an assignment.
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
            if not is_owner:
                await db.rollback()
                return AssignmentResult(status="forbidden")
            contractor_id = await resolve_contractor_user_id(db, contractor_id)

        error = await assign_locked(
            db, project=project, contractor_id=contractor_id, actor_id=actor_id,
        )
        if error is not None:
            current = project.contractor_id
            await db.rollback()
            return AssignmentResult(
                status=error,
                current_contractor_id=current if error == "already_assigned" else None,
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    loaded = await _loaded_project(db, project_id)
    if loaded is None:
        raise ValueError("project_assignment_entity_missing")
    if actor_id is not None:
        from app.services import lifecycle_notifications

        try:
            await lifecycle_notifications.notify_contractor_assigned(
                db, project_id=project_id, contractor_id=contractor_id, actor_id=actor_id,
            )
        except Exception:  # noqa: BLE001 — уведомление не отменяет назначение
            await db.rollback()
            logging.getLogger(__name__).exception("contractor assignment notification failed")
    return AssignmentResult(status="assigned", project=loaded, current_contractor_id=contractor_id)
