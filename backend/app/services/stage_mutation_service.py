"""Atomic, role-scoped lifecycle for stage creation, start and configuration."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Room, Stage, StageStatus, User, UserRole
from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
from app.services import outbox_service as outbox
from app.services import team_service

STAGE_CREATE_SCOPE = "stage.create"


@dataclass(frozen=True)
class StageMutationResult:
    stage: Stage
    replayed: bool


def _status(stage: Stage) -> StageStatus:
    return stage.status if isinstance(stage.status, StageStatus) else StageStatus(str(stage.status))


async def _locked_project(db: AsyncSession, project_id: str) -> Project | None:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _locked_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> Stage | None:
    query = select(Stage).where(Stage.id == stage_id, Stage.project_id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _require_schedule_actor(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> None:
    if actor.role != UserRole.contractor:
        raise ValueError("stage_schedule_actor_forbidden")
    if actor.id in {project.contractor_id, project.foreman_id}:
        return
    role = await team_service.team_role_for_project(db, actor, project)
    if role not in {"owner", "foreman"}:
        raise ValueError("stage_schedule_actor_forbidden")


def _executor_ids(project: Project, stage: Stage) -> set[str]:
    if stage.assignee_id:
        return {stage.assignee_id}
    return {
        user_id
        for user_id in {project.contractor_id, project.foreman_id}
        if user_id
    }


def _require_execution_actor(project: Project, stage: Stage, actor: User) -> None:
    if actor.role != UserRole.contractor or actor.id not in _executor_ids(project, stage):
        raise ValueError("stage_execution_actor_forbidden")


def _normalize_room_ids(room_ids: list[str] | None) -> list[str]:
    normalized = [str(room_id).strip() for room_id in (room_ids or [])]
    if any(not room_id for room_id in normalized):
        raise ValueError("stage_room_ids_invalid")
    if len(set(normalized)) != len(normalized):
        raise ValueError("stage_room_ids_duplicate")
    return normalized


async def _validate_room_ids(
    db: AsyncSession,
    *,
    project_id: str,
    room_ids: list[str],
) -> None:
    if not room_ids:
        return
    found = set(
        (
            await db.execute(
                select(Room.id).where(
                    Room.project_id == project_id,
                    Room.id.in_(room_ids),
                    Room.is_archived.is_(False),
                )
            )
        ).scalars().all()
    )
    if found != set(room_ids):
        raise ValueError("stage_room_ids_invalid")


def _validate_dates(
    project: Project,
    *,
    planned_start: date | None,
    planned_end: date | None,
) -> None:
    if planned_start and planned_end and planned_end < planned_start:
        raise ValueError("stage_dates_invalid")
    if project.planned_start_date and planned_start and planned_start < project.planned_start_date:
        raise ValueError("stage_dates_outside_project")
    if project.planned_end_date and planned_end and planned_end > project.planned_end_date:
        raise ValueError("stage_dates_outside_project")


async def _confirmed_schedule_exists(db: AsyncSession, project_id: str) -> bool:
    return bool(
        await db.scalar(
            select(func.count())
            .select_from(ProjectWorkSchedule)
            .where(
                ProjectWorkSchedule.project_id == project_id,
                ProjectWorkSchedule.status == WorkScheduleStatus.confirmed,
            )
        )
    )


async def _enqueue_activity(
    db: AsyncSession,
    *,
    stage: Stage,
    actor_id: str,
    kind: str,
    title: str,
    body: str | None = None,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="stage",
        aggregate_id=stage.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": stage.project_id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "stage_id": stage.id,
            "work_type": stage.work_type,
            "link_path": f"/stage/{stage.id}",
        },
    )


async def _enqueue_customer_notification(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    notification_type: str,
    title: str,
    body: str,
) -> None:
    if not project.customer_id:
        return
    await outbox.enqueue(
        db,
        aggregate_type="stage",
        aggregate_id=stage.id,
        event_type=outbox.NOTIFICATION_EVENT,
        payload={
            "user_id": project.customer_id,
            "project_id": project.id,
            "notification_type": notification_type,
            "title": title,
            "body": body,
            "link_path": f"/stage/{stage.id}",
            "return_to": "/(customer)/(tabs)/repair?tab=control",
        },
    )


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def _load_stage(db: AsyncSession, *, project_id: str, stage_id: str) -> Stage:
    from app.services.stage_service import get_stage_full

    stage = await get_stage_full(db, stage_id)
    if stage is None or stage.project_id != project_id:
        raise ValueError("stage_entity_missing")
    return stage


async def create_stage(
    db: AsyncSession,
    *,
    project_id: str,
    actor: User,
    name: str,
    planned_start: date | None = None,
    planned_end: date | None = None,
    room_ids: list[str] | None = None,
    work_type: str | None = None,
    client_request_id: str | None = None,
) -> StageMutationResult:
    """Create exactly one stage, request ledger and durable effects in one commit."""
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    canonical_project_id = str(project_id)
    project = await _locked_project(db, canonical_project_id)
    if project is None:
        await db.rollback()
        raise ValueError("project_not_found")
    actor_id = actor.id
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        clean_name = name.strip()
        if not clean_name or len(clean_name) > 255:
            raise ValueError("stage_name_invalid")
        clean_work_type = (work_type or "").strip() or None
        if clean_work_type and len(clean_work_type) > 64:
            raise ValueError("stage_work_type_invalid")
        normalized_rooms = _normalize_room_ids(room_ids)
        _validate_dates(
            project,
            planned_start=planned_start,
            planned_end=planned_end,
        )
        await _validate_room_ids(
            db,
            project_id=canonical_project_id,
            room_ids=normalized_rooms,
        )
        payload = {
            "name": clean_name,
            "planned_start": planned_start.isoformat() if planned_start else None,
            "planned_end": planned_end.isoformat() if planned_end else None,
            "room_ids": normalized_rooms,
            "work_type": clean_work_type,
        }
        replay_id = await replay_entity_id(
            db,
            scope=STAGE_CREATE_SCOPE,
            project_id=canonical_project_id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            await db.commit()
            return StageMutationResult(
                await _load_stage(
                    db,
                    project_id=canonical_project_id,
                    stage_id=replay_id,
                ),
                True,
            )

        sort_order = int(
            await db.scalar(
                select(func.coalesce(func.max(Stage.sort_order), -1)).where(
                    Stage.project_id == canonical_project_id
                )
            )
        ) + 1
        stage = Stage(
            project_id=canonical_project_id,
            name=clean_name,
            sort_order=sort_order,
            status=StageStatus.planned,
            percent_complete=0,
            payment_amount=0,
            weight_coefficient=0,
            planned_start=planned_start,
            planned_end=planned_end,
            room_ids_json=(
                json.dumps(normalized_rooms, ensure_ascii=False)
                if normalized_rooms
                else None
            ),
            work_type=clean_work_type,
        )
        db.add(stage)
        await db.flush()
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor_id,
            kind="StageCreated",
            title=f"Добавлен этап: {stage.name}",
        )
        await _enqueue_customer_notification(
            db,
            project=project,
            stage=stage,
            notification_type="stage_start",
            title="Добавлен этап работ",
            body=stage.name,
        )
        candidate_id = stage.id
        created, entity_id = await commit_client_write(
            db,
            scope=STAGE_CREATE_SCOPE,
            project_id=canonical_project_id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=candidate_id,
        )
    except BaseException:
        await db.rollback()
        raise

    loaded = await _load_stage(
        db,
        project_id=canonical_project_id,
        stage_id=candidate_id if created else entity_id,
    )
    if created:
        await _dispatch(db, "stage.create")
    return StageMutationResult(loaded, not created)


async def start_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
) -> tuple[StageMutationResult | None, dict | None]:
    """Start one planned stage with dependency checks and durable effects."""
    from app.services import dependency_service
    from app.services import project_document_service

    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None, {"code": "project_not_found"}
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None, {"code": "stage_not_found"}
    try:
        _require_execution_actor(project, stage, actor)
    except ValueError:
        await db.rollback()
        raise

    status = _status(stage)
    if status == StageStatus.active:
        await db.commit()
        return StageMutationResult(stage, True), None
    if status != StageStatus.planned:
        await db.rollback()
        return None, {
            "code": "stage_start_invalid_status",
            "status": status.value,
        }

    gate = await project_document_service.project_contract_gate(db, project.id)
    if not gate.get("ok"):
        await db.rollback()
        return None, {
            "code": gate.get("code", "contract_not_signed"),
            "message": gate.get("message"),
            "pending_titles": gate.get("pending_titles", []),
        }
    blocked = await dependency_service.evaluate_stage(
        db,
        stage,
        commit=False,
        persist_status=True,
    )
    if blocked.get("blocked"):
        await db.rollback()
        return None, {
            "code": "blocked",
            "reasons": blocked.get("reasons", []),
        }

    try:
        stage.status = StageStatus.active
        if stage.actual_start is None:
            stage.actual_start = date.today()
        if not stage.ical_uid:
            stage.ical_uid = f"renova-{stage.id}@app"
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageStarted",
            title=f"Начат этап: {stage.name}",
        )
        await _enqueue_customer_notification(
            db,
            project=project,
            stage=stage,
            notification_type="stage_start",
            title=f"Начат этап: {stage.name}",
            body="Исполнитель приступил к работам",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(stage)
    await _dispatch(db, "stage.start")
    return StageMutationResult(stage, False), None


async def update_dates(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    planned_start: date | None,
    planned_end: date | None,
) -> StageMutationResult | None:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        if await _confirmed_schedule_exists(db, project.id):
            raise ValueError("confirmed_schedule_controls_dates")
        next_start = planned_start if planned_start is not None else stage.planned_start
        next_end = planned_end if planned_end is not None else stage.planned_end
        _validate_dates(project, planned_start=next_start, planned_end=next_end)
        if next_start == stage.planned_start and next_end == stage.planned_end:
            await db.commit()
            return StageMutationResult(stage, True)
        stage.planned_start = next_start
        stage.planned_end = next_end
        if not stage.ical_uid:
            stage.ical_uid = f"renova-{stage.id}@app"
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageDatesChanged",
            title=f"Изменены даты этапа: {stage.name}",
            body=(
                f"{next_start.isoformat() if next_start else '—'} — "
                f"{next_end.isoformat() if next_end else '—'}"
            ),
        )
        await _enqueue_customer_notification(
            db,
            project=project,
            stage=stage,
            notification_type="stage_start",
            title="Изменены даты этапа",
            body=stage.name,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(stage)
    await _dispatch(db, "stage.dates")
    return StageMutationResult(stage, False)


async def update_rooms(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    room_ids: list[str],
) -> StageMutationResult | None:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        if _status(stage) != StageStatus.planned:
            raise ValueError("stage_configuration_locked")
        normalized = _normalize_room_ids(room_ids)
        await _validate_room_ids(db, project_id=project.id, room_ids=normalized)
        current = []
        if stage.room_ids_json:
            try:
                current = list(json.loads(stage.room_ids_json))
            except Exception:
                current = []
        if current == normalized:
            await db.commit()
            return StageMutationResult(stage, True)
        stage.room_ids_json = (
            json.dumps(normalized, ensure_ascii=False) if normalized else None
        )
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageRoomsChanged",
            title=f"Изменены помещения этапа: {stage.name}",
            body=f"Помещений: {len(normalized)}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(stage)
    await _dispatch(db, "stage.rooms")
    return StageMutationResult(stage, False)


async def update_work_type(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    work_type: str | None,
) -> StageMutationResult | None:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        if _status(stage) != StageStatus.planned:
            raise ValueError("stage_configuration_locked")
        normalized = (work_type or "").strip() or None
        if normalized and len(normalized) > 64:
            raise ValueError("stage_work_type_invalid")
        if stage.work_type == normalized:
            await db.commit()
            return StageMutationResult(stage, True)
        previous = stage.work_type
        stage.work_type = normalized
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageWorkTypeChanged",
            title=f"Изменён тип работ: {stage.name}",
            body=f"{previous or '—'} → {normalized or '—'}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(stage)
    await _dispatch(db, "stage.work_type")
    return StageMutationResult(stage, False)


async def _assert_no_dependency_cycle(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    predecessor: Stage,
) -> None:
    seen = {stage_id}
    current: Stage | None = predecessor
    while current is not None:
        if current.id in seen:
            raise ValueError("stage_dependency_cycle")
        seen.add(current.id)
        if not current.depends_on_stage_id:
            return
        current = await db.scalar(
            select(Stage).where(
                Stage.id == current.depends_on_stage_id,
                Stage.project_id == project_id,
            )
        )


async def update_dependency(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    depends_on_stage_id: str | None,
) -> StageMutationResult | None:
    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        if _status(stage) != StageStatus.planned:
            raise ValueError("stage_configuration_locked")
        predecessor = None
        if depends_on_stage_id:
            if depends_on_stage_id == stage.id:
                raise ValueError("stage_dependency_cycle")
            predecessor = await db.scalar(
                select(Stage).where(
                    Stage.id == depends_on_stage_id,
                    Stage.project_id == project.id,
                )
            )
            if predecessor is None:
                raise ValueError("stage_dependency_invalid")
            await _assert_no_dependency_cycle(
                db,
                project_id=project.id,
                stage_id=stage.id,
                predecessor=predecessor,
            )
        if stage.depends_on_stage_id == depends_on_stage_id:
            await db.commit()
            return StageMutationResult(stage, True)
        previous = stage.depends_on_stage_id
        stage.depends_on_stage_id = depends_on_stage_id
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageDependencyChanged",
            title=f"Изменена зависимость этапа: {stage.name}",
            body=f"{previous or '—'} → {depends_on_stage_id or '—'}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(stage)
    await _dispatch(db, "stage.dependency")
    return StageMutationResult(stage, False)


async def sync_dependencies(
    db: AsyncSession,
    *,
    project_id: str,
    actor: User,
) -> int:
    from app.services import dependency_service

    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        raise ValueError("project_not_found")
    try:
        await _require_schedule_actor(db, project=project, actor=actor)
        count = await dependency_service.sync_from_workflow(
            db,
            project.id,
            commit=False,
        )
        if count:
            await outbox.enqueue(
                db,
                aggregate_type="project",
                aggregate_id=project.id,
                event_type=outbox.ACTIVITY_EVENT,
                payload={
                    "project_id": project.id,
                    "user_id": actor.id,
                    "kind": "StageDependenciesSynced",
                    "title": "Синхронизированы зависимости этапов",
                    "body": f"Добавлено: {count}",
                    "link_path": "/(contractor)/(tabs)/repair?tab=works",
                },
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    if count:
        await _dispatch(db, "stage.dependencies.sync")
    return count
