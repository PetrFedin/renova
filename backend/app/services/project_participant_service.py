"""Fail-closed project participant and scope foundation for multi-contractor work."""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, Room, Stage, User, UserRole
from app.models.project_participants import (
    ProjectParticipant,
    ProjectParticipantEvent,
    ProjectParticipantScope,
    SCOPE_TYPES,
)


@dataclass(frozen=True)
class ScopeRef:
    scope_type: str
    scope_ref: str


def _normalize_scope(scope: ScopeRef | tuple[str, str] | dict) -> ScopeRef:
    if isinstance(scope, ScopeRef):
        scope_type, scope_ref = scope.scope_type, scope.scope_ref
    elif isinstance(scope, tuple):
        scope_type, scope_ref = scope
    else:
        scope_type = str(scope.get("scope_type") or "")
        scope_ref = str(scope.get("scope_ref") or "")
    scope_type = scope_type.strip()
    scope_ref = scope_ref.strip()
    if scope_type not in SCOPE_TYPES:
        raise ValueError("participant_scope_type_invalid")
    if not scope_ref or len(scope_ref) > 64:
        raise ValueError("participant_scope_ref_invalid")
    return ScopeRef(scope_type, scope_ref)


def _scope_snapshot(scopes: list[ScopeRef]) -> str:
    return json.dumps(
        [{"scope_type": s.scope_type, "scope_ref": s.scope_ref} for s in scopes],
        ensure_ascii=False,
        sort_keys=True,
    )


async def active_participant(
    db: AsyncSession, *, project_id: str, user_id: str
) -> ProjectParticipant | None:
    return await db.scalar(
        select(ProjectParticipant).where(
            ProjectParticipant.project_id == project_id,
            ProjectParticipant.user_id == user_id,
            ProjectParticipant.status == "active",
        )
    )


async def participant_scopes(
    db: AsyncSession, participant_id: str
) -> list[ProjectParticipantScope]:
    return list(
        (
            await db.execute(
                select(ProjectParticipantScope)
                .where(ProjectParticipantScope.participant_id == participant_id)
                .order_by(
                    ProjectParticipantScope.scope_type.asc(),
                    ProjectParticipantScope.scope_ref.asc(),
                )
            )
        ).scalars().all()
    )


async def _validate_scopes(
    db: AsyncSession, *, project_id: str, scopes: list[ScopeRef]
) -> None:
    stage_ids = {s.scope_ref for s in scopes if s.scope_type == "stage"}
    room_ids = {s.scope_ref for s in scopes if s.scope_type == "room"}
    if stage_ids:
        found = set(
            (
                await db.execute(
                    select(Stage.id).where(
                        Stage.project_id == project_id,
                        Stage.id.in_(stage_ids),
                    )
                )
            ).scalars().all()
        )
        if found != stage_ids:
            raise ValueError("participant_stage_scope_cross_project")
    if room_ids:
        found = set(
            (
                await db.execute(
                    select(Room.id).where(
                        Room.project_id == project_id,
                        Room.id.in_(room_ids),
                    )
                )
            ).scalars().all()
        )
        if found != room_ids:
            raise ValueError("participant_room_scope_cross_project")


async def _record_event(
    db: AsyncSession,
    *,
    participant: ProjectParticipant,
    event_type: str,
    actor_id: str | None,
    snapshot_json: str | None = None,
) -> None:
    db.add(
        ProjectParticipantEvent(
            participant_id=participant.id,
            project_id=participant.project_id,
            user_id=participant.user_id,
            event_type=event_type,
            actor_id=actor_id,
            snapshot_json=snapshot_json,
        )
    )


async def _locked_customer_project(
    db: AsyncSession, *, project_id: str, actor_id: str
) -> Project:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    project = (await db.execute(query)).scalar_one_or_none()
    if project is None:
        raise ValueError("project_not_found")
    if project.customer_id != actor_id:
        raise ValueError("participant_customer_owner_only")
    return project


async def add_or_reactivate_contractor(
    db: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
    contractor_id: str,
    scopes: list[ScopeRef | tuple[str, str] | dict] | None = None,
) -> tuple[ProjectParticipant, bool]:
    """Add one independent contractor principal, serialized on the project row.

    This mutation deliberately does *not* grant generic project access. Domain
    routes must adopt participant scope explicitly; until then the new principal
    remains fail-closed outside scoped helpers.
    """
    project = await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
    target = await db.get(User, contractor_id)
    if target is None or target.role != UserRole.contractor or target.deleted_at is not None:
        await db.rollback()
        raise ValueError("participant_contractor_invalid")
    if contractor_id == project.contractor_id:
        await db.rollback()
        raise ValueError("participant_is_legacy_lead")

    normalized = sorted(
        {_normalize_scope(scope) for scope in (scopes or [])},
        key=lambda s: (s.scope_type, s.scope_ref),
    )
    await _validate_scopes(db, project_id=project_id, scopes=normalized)

    query = select(ProjectParticipant).where(
        ProjectParticipant.project_id == project_id,
        ProjectParticipant.user_id == contractor_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    participant = (await db.execute(query)).scalar_one_or_none()
    created = participant is None
    event_type = "added"
    if participant is None:
        participant = ProjectParticipant(
            project_id=project_id,
            user_id=contractor_id,
            participant_role="contractor",
            status="active",
            all_scope=False,
            can_manage_schedule=False,
            can_manage_commercial=False,
            can_manage_documents=False,
            added_by=actor_id,
        )
        db.add(participant)
        await db.flush()
    elif participant.status == "removed":
        participant.status = "active"
        participant.removed_by = None
        participant.removed_at = None
        participant.added_by = actor_id
        participant.added_at = utc_now()
        event_type = "reactivated"
    else:
        if scopes is None:
            await db.commit()
            return participant, False
        current = {
            (row.scope_type, row.scope_ref)
            for row in await participant_scopes(db, participant.id)
        }
        requested = {(scope.scope_type, scope.scope_ref) for scope in normalized}
        if current == requested:
            await db.commit()
            return participant, False
        event_type = "scope_replaced"

    if scopes is not None:
        await db.execute(
            delete(ProjectParticipantScope).where(
                ProjectParticipantScope.participant_id == participant.id
            )
        )
        for scope in normalized:
            db.add(
                ProjectParticipantScope(
                    participant_id=participant.id,
                    scope_type=scope.scope_type,
                    scope_ref=scope.scope_ref,
                    created_by=actor_id,
                )
            )
    await _record_event(
        db,
        participant=participant,
        event_type=event_type,
        actor_id=actor_id,
        snapshot_json=_scope_snapshot(normalized) if scopes is not None else None,
    )
    await db.commit()
    await db.refresh(participant)
    return participant, created


async def replace_scopes(
    db: AsyncSession,
    *,
    project_id: str,
    participant_id: str,
    actor_id: str,
    scopes: list[ScopeRef | tuple[str, str] | dict],
) -> ProjectParticipant:
    await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
    normalized = sorted(
        {_normalize_scope(scope) for scope in scopes},
        key=lambda s: (s.scope_type, s.scope_ref),
    )
    await _validate_scopes(db, project_id=project_id, scopes=normalized)
    participant = await db.scalar(
        select(ProjectParticipant).where(
            ProjectParticipant.id == participant_id,
            ProjectParticipant.project_id == project_id,
            ProjectParticipant.status == "active",
        )
    )
    if participant is None:
        await db.rollback()
        raise ValueError("participant_not_found")
    if participant.participant_role == "lead_contractor":
        await db.rollback()
        raise ValueError("participant_legacy_lead_scope_managed_by_compatibility")
    current = {
        (row.scope_type, row.scope_ref)
        for row in await participant_scopes(db, participant.id)
    }
    requested = {(scope.scope_type, scope.scope_ref) for scope in normalized}
    if current == requested:
        await db.commit()
        return participant
    await db.execute(
        delete(ProjectParticipantScope).where(
            ProjectParticipantScope.participant_id == participant.id
        )
    )
    for scope in normalized:
        db.add(
            ProjectParticipantScope(
                participant_id=participant.id,
                scope_type=scope.scope_type,
                scope_ref=scope.scope_ref,
                created_by=actor_id,
            )
        )
    await _record_event(
        db,
        participant=participant,
        event_type="scope_replaced",
        actor_id=actor_id,
        snapshot_json=_scope_snapshot(normalized),
    )
    await db.commit()
    return participant


async def remove_contractor(
    db: AsyncSession,
    *,
    project_id: str,
    participant_id: str,
    actor_id: str,
) -> ProjectParticipant:
    await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
    participant = await db.scalar(
        select(ProjectParticipant).where(
            ProjectParticipant.id == participant_id,
            ProjectParticipant.project_id == project_id,
        )
    )
    if participant is None:
        await db.rollback()
        raise ValueError("participant_not_found")
    if participant.participant_role == "lead_contractor":
        await db.rollback()
        raise ValueError("participant_legacy_lead_remove_forbidden")
    if participant.status == "removed":
        await db.commit()
        return participant
    participant.status = "removed"
    participant.removed_by = actor_id
    participant.removed_at = utc_now()
    await _record_event(
        db,
        participant=participant,
        event_type="removed",
        actor_id=actor_id,
    )
    await db.commit()
    return participant


async def scope_allows(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
    stage_id: str | None = None,
    room_id: str | None = None,
    work_type: str | None = None,
) -> bool:
    """Return scoped participant access without granting project-global access."""
    if project.contractor_id == user_id:
        return True
    participant = await active_participant(db, project_id=project.id, user_id=user_id)
    if participant is None:
        return False
    if participant.all_scope:
        return True
    requested = {
        ("stage", stage_id.strip()) if stage_id else None,
        ("room", room_id.strip()) if room_id else None,
        ("work_type", work_type.strip()) if work_type else None,
    }
    requested.discard(None)
    if not requested:
        return False
    rows = await participant_scopes(db, participant.id)
    granted = {(row.scope_type, row.scope_ref) for row in rows}
    return bool(requested & granted)


async def stage_assignee_allowed(
    db: AsyncSession, *, project: Project, stage: Stage, user_id: str
) -> bool:
    if project.contractor_id == user_id:
        return True
    room_ids: list[str] = []
    if stage.room_ids_json:
        try:
            raw = json.loads(stage.room_ids_json)
            if isinstance(raw, list):
                room_ids = [str(value) for value in raw]
        except (TypeError, ValueError, json.JSONDecodeError):
            room_ids = []
    if await scope_allows(
        db,
        project=project,
        user_id=user_id,
        stage_id=stage.id,
        work_type=stage.work_type,
    ):
        return True
    for room_id in room_ids:
        if await scope_allows(db, project=project, user_id=user_id, room_id=room_id):
            return True
    return False
