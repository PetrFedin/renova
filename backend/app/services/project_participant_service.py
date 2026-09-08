"""Fail-closed project participant and scope foundation for multi-contractor work."""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, Room, Stage, User, UserRole
from app.models.project_participants import (
    ProjectParticipant, ProjectParticipantEvent, ProjectParticipantScope, SCOPE_TYPES,
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
    scope_type, scope_ref = scope_type.strip(), scope_ref.strip()
    if scope_type not in SCOPE_TYPES:
        raise ValueError("participant_scope_type_invalid")
    if not scope_ref or len(scope_ref) > 64:
        raise ValueError("participant_scope_ref_invalid")
    return ScopeRef(scope_type, scope_ref)


def _scope_snapshot(scopes: list[ScopeRef]) -> str:
    return json.dumps(
        [{"scope_type": s.scope_type, "scope_ref": s.scope_ref} for s in scopes],
        ensure_ascii=False, sort_keys=True,
    )


def _event_snapshot(**values: object) -> str:
    return json.dumps(values, ensure_ascii=False, sort_keys=True)


async def active_participant(
    db: AsyncSession, *, project_id: str, user_id: str,
) -> ProjectParticipant | None:
    return await db.scalar(
        select(ProjectParticipant).where(
            ProjectParticipant.project_id == project_id,
            ProjectParticipant.user_id == user_id,
            ProjectParticipant.status == "active",
        ).execution_options(populate_existing=True)
    )


async def list_project_participants(
    db: AsyncSession, *, project_id: str, include_removed: bool = False,
) -> list[ProjectParticipant]:
    query = select(ProjectParticipant).where(ProjectParticipant.project_id == project_id)
    if not include_removed:
        query = query.where(ProjectParticipant.status == "active")
    return list((await db.scalars(query.order_by(
        ProjectParticipant.status.asc(), ProjectParticipant.participant_role.asc(),
        ProjectParticipant.added_at.asc(), ProjectParticipant.id.asc(),
    ).execution_options(populate_existing=True))).all())


async def participant_scopes(db: AsyncSession, participant_id: str) -> list[ProjectParticipantScope]:
    return list((await db.scalars(
        select(ProjectParticipantScope)
        .where(ProjectParticipantScope.participant_id == participant_id)
        .order_by(ProjectParticipantScope.scope_type.asc(), ProjectParticipantScope.scope_ref.asc())
        .execution_options(populate_existing=True)
    )).all())


async def _validate_scopes(
    db: AsyncSession, *, project_id: str, scopes: list[ScopeRef],
) -> None:
    stage_ids = {s.scope_ref for s in scopes if s.scope_type == "stage"}
    room_ids = {s.scope_ref for s in scopes if s.scope_type == "room"}
    if stage_ids:
        found = set((await db.scalars(
            select(Stage.id).where(Stage.project_id == project_id, Stage.id.in_(stage_ids))
        )).all())
        if found != stage_ids:
            raise ValueError("participant_stage_scope_cross_project")
    if room_ids:
        found = set((await db.scalars(
            select(Room.id).where(Room.project_id == project_id, Room.id.in_(room_ids))
        )).all())
        if found != room_ids:
            raise ValueError("participant_room_scope_cross_project")


async def _record_event(
    db: AsyncSession, *, participant: ProjectParticipant, event_type: str,
    actor_id: str | None, snapshot_json: str | None = None,
) -> None:
    db.add(ProjectParticipantEvent(
        participant_id=participant.id, project_id=participant.project_id,
        user_id=participant.user_id, event_type=event_type,
        actor_id=actor_id, snapshot_json=snapshot_json,
    ))


async def sync_current_lead_in_transaction(
    db: AsyncSession, *, project: Project, contractor_id: str, actor_id: str | None = None,
) -> ProjectParticipant:
    """Synchronize current lead, participant and audit without committing.

    The caller must own a freshly locked existing Project, or have just inserted
    this Project in the same transaction. This helper is not an authorization API.
    """
    target = await db.get(User, contractor_id, populate_existing=True)
    if target is None or target.role != UserRole.contractor or target.deleted_at is not None:
        raise ValueError("participant_contractor_invalid")
    now = utc_now()
    stale_leads = list((await db.scalars(
        select(ProjectParticipant).where(
            ProjectParticipant.project_id == project.id,
            ProjectParticipant.participant_role == "lead_contractor",
            ProjectParticipant.status == "active",
            ProjectParticipant.user_id != contractor_id,
        ).execution_options(populate_existing=True)
    )).all())
    for stale in stale_leads:
        stale.status = "removed"
        stale.all_scope = False
        stale.can_manage_schedule = False
        stale.can_manage_commercial = False
        stale.can_manage_documents = False
        stale.removed_by, stale.removed_at = actor_id, now
        await _record_event(
            db, participant=stale, event_type="removed", actor_id=actor_id,
            snapshot_json=_event_snapshot(reason="lead_replaced", next_lead_user_id=contractor_id),
        )

    participant = await db.scalar(
        select(ProjectParticipant).where(
            ProjectParticipant.project_id == project.id,
            ProjectParticipant.user_id == contractor_id,
        ).with_for_update().execution_options(populate_existing=True)
    )
    event_type: str | None = None
    reason = "lead_assignment"
    if participant is None:
        participant = ProjectParticipant(
            project_id=project.id, user_id=contractor_id,
            participant_role="lead_contractor", status="active", all_scope=True,
            can_manage_schedule=True, can_manage_commercial=True,
            can_manage_documents=True, added_by=actor_id,
        )
        db.add(participant)
        await db.flush()
        event_type = "added"
    else:
        existing_scopes = await participant_scopes(db, participant.id)
        was_removed = participant.status == "removed"
        canonical = (
            participant.participant_role == "lead_contractor"
            and participant.status == "active" and participant.all_scope is True
            and participant.can_manage_schedule is True
            and participant.can_manage_commercial is True
            and participant.can_manage_documents is True and not existing_scopes
        )
        if not canonical:
            if existing_scopes:
                await db.execute(delete(ProjectParticipantScope).where(
                    ProjectParticipantScope.participant_id == participant.id,
                ))
            participant.participant_role = "lead_contractor"
            participant.status, participant.all_scope = "active", True
            participant.can_manage_schedule = True
            participant.can_manage_commercial = True
            participant.can_manage_documents = True
            participant.removed_by, participant.removed_at = None, None
            if was_removed:
                participant.added_by, participant.added_at = actor_id, now
                event_type, reason = "reactivated", "lead_reactivated"
            else:
                event_type, reason = "scope_replaced", "promoted_or_repaired_lead"
    project.contractor_id = contractor_id
    if event_type is not None:
        await _record_event(
            db, participant=participant, event_type=event_type, actor_id=actor_id,
            snapshot_json=_event_snapshot(
                reason=reason, participant_role="lead_contractor", all_scope=True,
            ),
        )
    await db.flush()
    return participant


async def _locked_customer_project(
    db: AsyncSession, *, project_id: str, actor_id: str,
) -> Project:
    project = await db.scalar(
        select(Project).where(Project.id == project_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if project is None:
        raise ValueError("project_not_found")
    actor = await db.get(User, actor_id, populate_existing=True)
    if (
        project.customer_id != actor_id or actor is None
        or actor.role != UserRole.customer or actor.deleted_at is not None
    ):
        raise ValueError("participant_customer_owner_only")
    if project.trashed_at is not None:
        raise ValueError("project_trashed")
    return project


async def _replace_scope_rows(
    db: AsyncSession, *, participant: ProjectParticipant,
    scopes: list[ScopeRef], actor_id: str,
) -> None:
    await db.execute(delete(ProjectParticipantScope).where(
        ProjectParticipantScope.participant_id == participant.id,
    ))
    for scope in scopes:
        db.add(ProjectParticipantScope(
            participant_id=participant.id, scope_type=scope.scope_type,
            scope_ref=scope.scope_ref, created_by=actor_id,
        ))


def _deny_default(participant: ProjectParticipant) -> None:
    participant.participant_role = "contractor"
    participant.all_scope = False
    participant.can_manage_schedule = False
    participant.can_manage_commercial = False
    participant.can_manage_documents = False


async def add_or_reactivate_contractor(
    db: AsyncSession, *, project_id: str, actor_id: str, contractor_id: str,
    scopes: list[ScopeRef | tuple[str, str] | dict] | None = None,
) -> tuple[ProjectParticipant, bool]:
    """Add one independent principal; membership never grants generic project ACL."""
    try:
        project = await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
        target = await db.get(User, contractor_id, populate_existing=True)
        if target is None or target.role != UserRole.contractor or target.deleted_at is not None:
            raise ValueError("participant_contractor_invalid")
        if contractor_id == project.contractor_id:
            raise ValueError("participant_is_legacy_lead")
        normalized = sorted(
            {_normalize_scope(scope) for scope in (scopes or [])},
            key=lambda s: (s.scope_type, s.scope_ref),
        )
        await _validate_scopes(db, project_id=project_id, scopes=normalized)
        participant = await db.scalar(
            select(ProjectParticipant).where(
                ProjectParticipant.project_id == project_id,
                ProjectParticipant.user_id == contractor_id,
            ).with_for_update().execution_options(populate_existing=True)
        )
        created = participant is None
        event_type = "added"
        reset_authorization = False
        if participant is None:
            participant = ProjectParticipant(
                project_id=project_id, user_id=contractor_id,
                participant_role="contractor", status="active", all_scope=False,
                can_manage_schedule=False, can_manage_commercial=False,
                can_manage_documents=False, added_by=actor_id,
            )
            db.add(participant)
            await db.flush()
        elif participant.status == "removed":
            participant.status = "active"
            participant.removed_by, participant.removed_at = None, None
            participant.added_by, participant.added_at = actor_id, utc_now()
            _deny_default(participant)
            event_type, reset_authorization = "reactivated", True
        elif participant.participant_role == "lead_contractor":
            # Explicitly adding a former lead as independent must change its
            # role as well as clear every old grant. Never revive all-scope.
            _deny_default(participant)
            event_type, reset_authorization = "scope_replaced", True
        else:
            if scopes is None:
                await db.commit()
                return participant, False
            current = {(r.scope_type, r.scope_ref) for r in await participant_scopes(db, participant.id)}
            requested = {(s.scope_type, s.scope_ref) for s in normalized}
            if current == requested:
                await db.commit()
                return participant, False
            event_type = "scope_replaced"
        replace_rows = scopes is not None or reset_authorization
        if replace_rows:
            await _replace_scope_rows(db, participant=participant, scopes=normalized, actor_id=actor_id)
        await _record_event(
            db, participant=participant, event_type=event_type, actor_id=actor_id,
            snapshot_json=_scope_snapshot(normalized) if replace_rows else None,
        )
        await db.commit()
        await db.refresh(participant)
        return participant, created
    except BaseException:
        await db.rollback()
        raise


async def replace_scopes(
    db: AsyncSession, *, project_id: str, participant_id: str, actor_id: str,
    scopes: list[ScopeRef | tuple[str, str] | dict],
) -> ProjectParticipant:
    try:
        project = await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
        normalized = sorted({_normalize_scope(s) for s in scopes}, key=lambda s: (s.scope_type, s.scope_ref))
        await _validate_scopes(db, project_id=project_id, scopes=normalized)
        participant = await db.scalar(
            select(ProjectParticipant).where(
                ProjectParticipant.id == participant_id,
                ProjectParticipant.project_id == project_id,
                ProjectParticipant.status == "active",
            ).with_for_update().execution_options(populate_existing=True)
        )
        if participant is None:
            raise ValueError("participant_not_found")
        if participant.participant_role == "lead_contractor" or participant.user_id == project.contractor_id:
            raise ValueError("participant_legacy_lead_scope_managed_by_compatibility")
        current = {(r.scope_type, r.scope_ref) for r in await participant_scopes(db, participant.id)}
        requested = {(s.scope_type, s.scope_ref) for s in normalized}
        if current != requested:
            await _replace_scope_rows(db, participant=participant, scopes=normalized, actor_id=actor_id)
            await _record_event(
                db, participant=participant, event_type="scope_replaced", actor_id=actor_id,
                snapshot_json=_scope_snapshot(normalized),
            )
        await db.commit()
        return participant
    except BaseException:
        await db.rollback()
        raise


async def remove_contractor(
    db: AsyncSession, *, project_id: str, participant_id: str, actor_id: str,
) -> ProjectParticipant:
    try:
        project = await _locked_customer_project(db, project_id=project_id, actor_id=actor_id)
        participant = await db.scalar(
            select(ProjectParticipant).where(
                ProjectParticipant.id == participant_id,
                ProjectParticipant.project_id == project_id,
            ).with_for_update().execution_options(populate_existing=True)
        )
        if participant is None:
            raise ValueError("participant_not_found")
        if participant.participant_role == "lead_contractor" or participant.user_id == project.contractor_id:
            raise ValueError("participant_legacy_lead_remove_forbidden")
        if participant.status != "removed":
            participant.status = "removed"
            participant.removed_by, participant.removed_at = actor_id, utc_now()
            await _record_event(db, participant=participant, event_type="removed", actor_id=actor_id)
        await db.commit()
        return participant
    except BaseException:
        await db.rollback()
        raise


async def scope_allows(
    db: AsyncSession, *, project: Project, user_id: str,
    stage_id: str | None = None, room_id: str | None = None, work_type: str | None = None,
) -> bool:
    """Return scoped authorization, not generic project access or cached lead truth."""
    current = (await db.execute(
        select(Project.contractor_id).where(Project.id == project.id, Project.trashed_at.is_(None))
    )).first()
    if current is None:
        return False
    if current.contractor_id == user_id:
        return True
    participant = await active_participant(db, project_id=project.id, user_id=user_id)
    if participant is None or participant.participant_role == "lead_contractor":
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
    granted = {(row.scope_type, row.scope_ref) for row in await participant_scopes(db, participant.id)}
    return bool(requested & granted)


async def stage_assignee_allowed(
    db: AsyncSession, *, project: Project, stage: Stage, user_id: str,
) -> bool:
    if stage.project_id != project.id:
        return False
    room_ids: list[str] = []
    if stage.room_ids_json:
        try:
            raw = json.loads(stage.room_ids_json)
            if isinstance(raw, list):
                room_ids = [str(value) for value in raw]
        except (TypeError, ValueError, json.JSONDecodeError):
            room_ids = []
    if await scope_allows(db, project=project, user_id=user_id, stage_id=stage.id, work_type=stage.work_type):
        return True
    for room_id in room_ids:
        if await scope_allows(db, project=project, user_id=user_id, room_id=room_id):
            return True
    return False
