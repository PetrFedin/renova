from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timeutil import utc_now
from app.models.entities import Project, User
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.services import outbox_service as outbox

ProviderType = Literal["individual", "company"]
SUPERVISOR_CAPABILITIES = frozenset(
    {"project_read", "communication", "quality_issue_write", "quality_review", "schedule_review"}
)


@dataclass(frozen=True)
class AssignmentMutationResult:
    assignment: ProjectTechnicalSupervisorAssignment | None
    representative: User | None
    replayed: bool


def _profile_code(value: str) -> str:
    code = (value or "").strip().upper()
    if not code or len(code) > 8:
        raise ValueError("technical_supervision_profile_code_invalid")
    return code


def _provider_type(value: str) -> ProviderType:
    normalized = (value or "").strip().lower()
    if normalized not in {"individual", "company"}:
        raise ValueError("technical_supervision_provider_type_invalid")
    return normalized  # type: ignore[return-value]


def _provider_name(value: str | None, *, provider_type: ProviderType, representative: User) -> str:
    normalized = " ".join((value or "").strip().split())
    if provider_type == "company" and not normalized:
        raise ValueError("technical_supervision_company_name_required")
    if not normalized:
        normalized = " ".join((representative.full_name or "").strip().split()) or representative.phone
    if not normalized or len(normalized) > 255:
        raise ValueError("technical_supervision_provider_name_invalid")
    return normalized


async def _locked_project(db: AsyncSession, project_id: str) -> Project | None:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def active_assignment(
    db: AsyncSession, project_id: str, *, lock: bool = False
) -> ProjectTechnicalSupervisorAssignment | None:
    query = (
        select(ProjectTechnicalSupervisorAssignment)
        .where(
            ProjectTechnicalSupervisorAssignment.project_id == project_id,
            ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
        )
        .order_by(
            ProjectTechnicalSupervisorAssignment.appointed_at.desc(),
            ProjectTechnicalSupervisorAssignment.id.desc(),
        )
        .limit(1)
    )
    if lock:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    return (await db.execute(query)).scalar_one_or_none()


async def active_assignment_for_user(
    db: AsyncSession, *, project_id: str, user_id: str
) -> ProjectTechnicalSupervisorAssignment | None:
    return (
        await db.execute(
            select(ProjectTechnicalSupervisorAssignment)
            .where(
                ProjectTechnicalSupervisorAssignment.project_id == project_id,
                ProjectTechnicalSupervisorAssignment.representative_user_id == user_id,
                ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def _assert_independent(db: AsyncSession, *, project: Project, representative: User) -> None:
    if representative.id == project.customer_id:
        raise ValueError("technical_supervision_customer_conflict")
    if project.contractor_id and representative.id == project.contractor_id:
        raise ValueError("technical_supervision_contractor_conflict")
    if project.contractor_id:
        from app.services import team_service as team_svc

        member = await team_svc.project_team_membership(
            db, user_id=representative.id, contractor_id=project.contractor_id
        )
        if member is not None:
            raise ValueError("technical_supervision_contractor_team_conflict")


async def is_active_supervisor(db: AsyncSession, *, project_id: str, user_id: str) -> bool:
    """Effective authority; later contractor/team conflicts revoke it fail-closed."""
    if await active_assignment_for_user(db, project_id=project_id, user_id=user_id) is None:
        return False
    project = await db.get(Project, project_id)
    user = await db.get(User, user_id)
    if project is None or user is None or user.deleted_at is not None:
        return False
    try:
        await _assert_independent(db, project=project, representative=user)
    except ValueError:
        return False
    return True


async def _representative(db: AsyncSession, profile_code: str) -> User | None:
    return await db.scalar(
        select(User).where(User.profile_code == profile_code, User.deleted_at.is_(None))
    )


async def _enqueue_activity(
    db: AsyncSession,
    *,
    assignment: ProjectTechnicalSupervisorAssignment,
    actor_id: str,
    kind: str,
    title: str,
    body: str | None,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="technical_supervision",
        aggregate_id=assignment.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": assignment.project_id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "link_path": "/object",
        },
    )


async def _enqueue_notification(
    db: AsyncSession,
    *,
    assignment: ProjectTechnicalSupervisorAssignment,
    user_id: str | None,
    title: str,
    body: str,
) -> None:
    if not user_id:
        return
    await outbox.enqueue(
        db,
        aggregate_type="technical_supervision",
        aggregate_id=assignment.id,
        event_type=outbox.NOTIFICATION_EVENT,
        payload={
            "user_id": user_id,
            "project_id": assignment.project_id,
            "notification_type": "technical_supervision",
            "title": title,
            "body": body,
            "link_path": "/object",
            "return_to": None,
        },
    )


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def appoint_or_replace(
    db: AsyncSession,
    *,
    project_id: str,
    actor: User,
    profile_code: str,
    provider_type: str,
    provider_name: str | None,
    expected_assignment_id: str | None = None,
) -> AssignmentMutationResult:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        raise ValueError("technical_supervision_project_not_found")
    if actor.id != project.customer_id:
        await db.rollback()
        raise ValueError("technical_supervision_customer_only")

    representative = await _representative(db, _profile_code(profile_code))
    if representative is None:
        await db.rollback()
        raise ValueError("technical_supervision_representative_not_found")
    await _assert_independent(db, project=project, representative=representative)

    normalized_type = _provider_type(provider_type)
    normalized_name = _provider_name(
        provider_name, provider_type=normalized_type, representative=representative
    )
    current = await active_assignment(db, project.id, lock=True)
    if expected_assignment_id is not None and (
        current is None or current.id != expected_assignment_id
    ):
        await db.rollback()
        raise ValueError("technical_supervision_assignment_changed")
    if (
        current is not None
        and current.representative_user_id == representative.id
        and current.provider_type == normalized_type
        and current.provider_name == normalized_name
    ):
        await db.commit()
        return AssignmentMutationResult(current, representative, True)

    now = utc_now()
    previous_id = current.id if current else None
    if current:
        current.revoked_at = now
        current.revoked_by_user_id = actor.id
    assignment = ProjectTechnicalSupervisorAssignment(
        project_id=project.id,
        representative_user_id=representative.id,
        provider_type=normalized_type,
        provider_name=normalized_name,
        appointed_by_user_id=actor.id,
        appointed_at=now,
        supersedes_assignment_id=previous_id,
    )
    db.add(assignment)
    try:
        await db.flush()
        await _enqueue_activity(
            db,
            assignment=assignment,
            actor_id=actor.id,
            kind="TechnicalSupervisionReplaced" if current else "TechnicalSupervisionAppointed",
            title="Технический надзор заменён" if current else "Назначен технический надзор",
            body=normalized_name,
        )
        await _enqueue_notification(
            db,
            assignment=assignment,
            user_id=representative.id,
            title="Вы назначены техническим надзором",
            body=f"Объект: {project.name}. Представитель: {normalized_name}",
        )
        if project.contractor_id:
            await _enqueue_notification(
                db,
                assignment=assignment,
                user_id=project.contractor_id,
                title="Заказчик назначил технический надзор",
                body=normalized_name,
            )
        if current and current.representative_user_id != representative.id:
            await _enqueue_notification(
                db,
                assignment=assignment,
                user_id=current.representative_user_id,
                title="Полномочия технического надзора завершены",
                body=f"Объект: {project.name}",
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(assignment)
    await _dispatch(db, "technical_supervision.appoint")
    return AssignmentMutationResult(assignment, representative, False)


async def revoke(
    db: AsyncSession,
    *,
    project_id: str,
    actor: User,
    expected_assignment_id: str | None = None,
) -> AssignmentMutationResult:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        raise ValueError("technical_supervision_project_not_found")
    if actor.id != project.customer_id:
        await db.rollback()
        raise ValueError("technical_supervision_customer_only")
    current = await active_assignment(db, project.id, lock=True)
    if current is None:
        if expected_assignment_id is not None:
            await db.rollback()
            raise ValueError("technical_supervision_assignment_changed")
        await db.commit()
        return AssignmentMutationResult(None, None, True)
    if expected_assignment_id is not None and current.id != expected_assignment_id:
        await db.rollback()
        raise ValueError("technical_supervision_assignment_changed")

    representative = await db.get(User, current.representative_user_id)
    current.revoked_at = utc_now()
    current.revoked_by_user_id = actor.id
    try:
        await _enqueue_activity(
            db,
            assignment=current,
            actor_id=actor.id,
            kind="TechnicalSupervisionRevoked",
            title="Технический надзор отозван",
            body=current.provider_name,
        )
        await _enqueue_notification(
            db,
            assignment=current,
            user_id=current.representative_user_id,
            title="Полномочия технического надзора завершены",
            body=f"Объект: {project.name}",
        )
        if project.contractor_id:
            await _enqueue_notification(
                db,
                assignment=current,
                user_id=project.contractor_id,
                title="Технический надзор отозван заказчиком",
                body=current.provider_name,
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(current)
    await _dispatch(db, "technical_supervision.revoke")
    return AssignmentMutationResult(current, representative, False)


def assignment_dict(
    assignment: ProjectTechnicalSupervisorAssignment, representative: User | None
) -> dict:
    return {
        "id": assignment.id,
        "project_id": assignment.project_id,
        "provider_type": assignment.provider_type,
        "provider_name": assignment.provider_name,
        "representative_user_id": assignment.representative_user_id,
        "representative_full_name": representative.full_name if representative else None,
        "representative_profile_code": representative.profile_code if representative else None,
        "appointed_by_user_id": assignment.appointed_by_user_id,
        "appointed_at": assignment.appointed_at.isoformat() if assignment.appointed_at else None,
        "revoked_at": assignment.revoked_at.isoformat() if assignment.revoked_at else None,
        "revoked_by_user_id": assignment.revoked_by_user_id,
        "supersedes_assignment_id": assignment.supersedes_assignment_id,
    }


async def assignment_with_representative(
    db: AsyncSession, assignment: ProjectTechnicalSupervisorAssignment
) -> tuple[ProjectTechnicalSupervisorAssignment, User | None]:
    return assignment, await db.get(User, assignment.representative_user_id)


async def history(
    db: AsyncSession, project_id: str
) -> list[tuple[ProjectTechnicalSupervisorAssignment, User | None]]:
    rows = list(
        (
            await db.execute(
                select(ProjectTechnicalSupervisorAssignment)
                .where(ProjectTechnicalSupervisorAssignment.project_id == project_id)
                .order_by(
                    ProjectTechnicalSupervisorAssignment.appointed_at.desc(),
                    ProjectTechnicalSupervisorAssignment.id.desc(),
                )
            )
        ).scalars().all()
    )
    ids = {row.representative_user_id for row in rows}
    users = {
        user.id: user for user in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    } if ids else {}
    return [(row, users.get(row.representative_user_id)) for row in rows]


async def project_access_descriptor(
    db: AsyncSession, *, user: User, project: Project
) -> tuple[str, bool, list[str]]:
    from app.services import team_service as team_svc

    mode, read_only = await team_svc.project_access_mode(db, user, project)
    if mode == "owner" or (mode == "contractor" and not read_only):
        return mode, read_only, []
    if await is_active_supervisor(db, project_id=project.id, user_id=user.id):
        return "supervisor", True, sorted(SUPERVISOR_CAPABILITIES)
    return mode, read_only, []


async def require_capability(
    db: AsyncSession, *, user: User, project: Project, capability: str
) -> str:
    from app.services import team_service as team_svc

    if await is_active_supervisor(db, project_id=project.id, user_id=user.id):
        if capability in SUPERVISOR_CAPABILITIES:
            return "supervisor"
        raise HTTPException(
            403,
            detail={"code": "technical_supervision_capability_forbidden", "capability": capability},
        )
    if capability == "project_read":
        if await team_svc.can_access_project(db, user, project, write=False):
            mode, _ = await team_svc.project_access_mode(db, user, project)
            return mode
        raise HTTPException(403, "project_forbidden")
    if capability == "quality_issue_write":
        return (await team_svc.require_capability(db, user, project, "field_write")) or "project_member"
    if capability == "communication":
        if not await team_svc.can_access_project(db, user, project, write=True):
            raise HTTPException(403, "communication_forbidden")
        mode, read_only = await team_svc.project_access_mode(db, user, project)
        if read_only:
            raise HTTPException(403, "communication_forbidden")
        return mode
    if capability in {"quality_review", "schedule_review"}:
        if user.id == project.customer_id:
            return "customer"
        raise HTTPException(403, f"{capability}_customer_or_supervisor_only")
    return (await team_svc.require_capability(db, user, project, capability)) or "project_member"


async def list_supervised_projects(
    db: AsyncSession, *, user_id: str, bucket: str = "active"
) -> list[Project]:
    query = (
        select(Project)
        .join(
            ProjectTechnicalSupervisorAssignment,
            ProjectTechnicalSupervisorAssignment.project_id == Project.id,
        )
        .where(
            ProjectTechnicalSupervisorAssignment.representative_user_id == user_id,
            ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
        )
        .options(
            selectinload(Project.stages),
            selectinload(Project.rooms),
            selectinload(Project.change_orders),
            selectinload(Project.receipts),
            selectinload(Project.payments),
        )
    )
    if bucket == "archived":
        query = query.where(Project.trashed_at.is_(None), Project.is_archived.is_(True))
    elif bucket == "trashed":
        return []
    else:
        query = query.where(Project.trashed_at.is_(None), Project.is_archived.is_(False))
    candidates = list(
        (await db.execute(query.order_by(Project.created_at.desc()))).scalars().unique().all()
    )
    return [
        project
        for project in candidates
        if await is_active_supervisor(db, project_id=project.id, user_id=user_id)
    ]
