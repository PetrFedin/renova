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


def is_self_managed_project(project: Project) -> bool:
    """A customer-only project has no contractor-side execution authority."""
    return project.contractor_id is None


def is_self_managed_customer(project: Project, actor: User) -> bool:
    return (
        is_self_managed_project(project)
        and actor.role == UserRole.customer
        and actor.id == project.customer_id
    )


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
    if is_self_managed_customer(project, actor):
        return
    if actor.role != UserRole.contractor:
        raise ValueError("stage_schedule_actor_forbidden")
    if actor.id == project.contractor_id:
        return
    role = await team_service.team_role_for_project(db, actor, project)
    if role not in {"owner", "foreman"}:
        raise ValueError("stage_schedule_actor_forbidden")


def _executor_ids(project: Project, stage: Stage) -> set[str]:
    if stage.assignee_id:
        return {stage.assignee_id}
    if is_self_managed_project(project) and project.customer_id:
        return {project.customer_id}
    return {project.contractor_id} if project.contractor_id else set()


def _require_execution_actor(project: Project, stage: Stage, actor: User) -> None:
    if is_self_managed_customer(project, actor) and actor.id in _executor_ids(project, stage):
        return
    if actor.role != UserRole.contractor or actor.id not in _executor_ids(project, stage):
        raise ValueError("stage_execution_actor_forbidden")


async def is_team_executor(db: AsyncSession, project: Project, actor: User) -> bool:
    """Owner/foreman of the lead contractor's team may execute any stage of the project.

    `stage.assignee_id` is never set by any flow, so without this the foreman could
    neither see nor start the lead's stages (STG-005/STG-006). A plain member only
    executes stages explicitly assigned to them (`_executor_ids`); a viewer never does.
    """
    if actor.role != UserRole.contractor or not project.contractor_id:
        return False
    role = await team_service.team_role_for_project(db, actor, project)
    return role in {"owner", "foreman"}


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
    actor_id: str | None = None,
) -> None:
    # Заказчик, ведущий, прораб, назначенный на этап член бригады, технадзор и гости
    # (кроме автора правки) — единый хелпер получателей (COM-005/COM-021).
    from app.services import notification_recipients as recipients_svc

    for user_id in sorted(
        await recipients_svc.project_recipients(
            db, project, recipients_svc.GENERAL, stage_id=stage.id, exclude=(actor_id,)
        )
    ):
        await outbox.enqueue(
            db,
            aggregate_type="stage",
            aggregate_id=stage.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": user_id,
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
            actor_id=actor_id,
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
        if not await is_team_executor(db, project, actor):
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

    # A customer doing their own renovation has no contractor agreement to sign.
    if not is_self_managed_customer(project, actor):
        gate = await project_document_service.project_contract_gate(db, project.id)
        if not gate.get("ok") or gate.get("reason") == "no_contract_required":
            await db.rollback()
            return None, {
                "code": gate.get("code", "contract_not_signed"),
                "message": gate.get("message") or "Подпишите договор перед началом работ",
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
            actor_id=actor.id,
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
        if stage.status == StageStatus.done:
            # STG-008: dates of an accepted stage are history.
            raise ValueError("stage_dates_locked_done")
        next_start = planned_start if planned_start is not None else stage.planned_start
        next_end = planned_end if planned_end is not None else stage.planned_end
        _validate_dates(project, planned_start=next_start, planned_end=next_end)
        if next_start == stage.planned_start and next_end == stage.planned_end:
            await db.commit()
            return StageMutationResult(stage, True)
        if stage.status == StageStatus.done:
            # STG-008: dates of an accepted stage are history.
            raise ValueError("stage_dates_locked_done")
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
            actor_id=actor.id,
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


WAIVED = "waived"


async def _has_active_work_dependency(db: AsyncSession, stage_id: str) -> bool:
    from app.models.entities import WorkDependency

    return bool(
        await db.scalar(
            select(func.count())
            .select_from(WorkDependency)
            .where(
                WorkDependency.stage_id == stage_id,
                WorkDependency.dependency_type == "work",
                WorkDependency.status != WAIVED,
            )
        )
    )


async def _waive_work_dependencies(db: AsyncSession, *, stage_id: str) -> int:
    """Mark the stage's work dependencies waived (kept as history; `sync` will not recreate them)."""
    from app.models.entities import WorkDependency

    rows = (
        await db.execute(
            select(WorkDependency).where(
                WorkDependency.stage_id == stage_id,
                WorkDependency.dependency_type == "work",
                WorkDependency.status != WAIVED,
            )
        )
    ).scalars().all()
    for row in rows:
        row.status = WAIVED
    return len(rows)


async def _require_structure_actor(db: AsyncSession, *, project: Project, actor: User) -> None:
    """Customer-owner or schedule actor (lead / foreman / self-managed customer)."""
    if actor.id == project.customer_id and actor.role == UserRole.customer:
        return
    await _require_schedule_actor(db, project=project, actor=actor)


async def remove_dependency(
    db: AsyncSession,
    *,
    project_id: str,
    dependency_id: str,
    actor: User,
) -> dict | None:
    """Waive one WorkDependency (stage or material) while its stage is not started."""
    from app.models.entities import WorkDependency

    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    dependency = await db.get(WorkDependency, dependency_id)
    if dependency is None or dependency.project_id != project.id:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=dependency.stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_structure_actor(db, project=project, actor=actor)
        if _status(stage) != StageStatus.planned:
            raise ValueError("stage_configuration_locked")
        if dependency.status == WAIVED:
            await db.commit()
            return {"id": dependency.id, "stage_id": stage.id, "status": WAIVED, "replayed": True}
        dependency.status = WAIVED
        if (
            dependency.dependency_type == "work"
            and dependency.depends_on_stage_id
            and stage.depends_on_stage_id == dependency.depends_on_stage_id
        ):
            stage.depends_on_stage_id = None
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageDependencyRemoved",
            title=f"Снята зависимость этапа: {stage.name}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await _dispatch(db, "stage.dependency.remove")
    return {"id": dependency.id, "stage_id": stage.id, "status": WAIVED, "replayed": False}


async def _stage_deletion_blockers(db: AsyncSession, stage: Stage) -> list[dict]:
    from app.models.entities import (
        Expense,
        Payment,
        ProjectIssue,
        Receipt,
        WorkAcceptance,
        WorkOrder,
    )

    checks = [
        ("stage_has_acceptances", "Есть записи приёмки", WorkAcceptance, []),
        ("stage_has_payments", "Есть платежи по этапу", Payment, []),
        ("stage_has_receipts", "Есть чеки по этапу", Receipt, []),
        ("stage_has_expenses", "Есть расходы по этапу", Expense, [Expense.status != "deleted"]),
        ("stage_has_issues", "Есть замечания по этапу", ProjectIssue, []),
        ("stage_has_work_orders", "Есть работы по этапу", WorkOrder, []),
    ]
    blockers: list[dict] = []
    for code, message, model, extra in checks:
        count = int(
            await db.scalar(
                select(func.count()).select_from(model).where(model.stage_id == stage.id, *extra)
            )
            or 0
        )
        if count:
            blockers.append({"code": code, "message": message, "count": count})
    return blockers


async def delete_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
) -> dict | None:
    """Delete (cancel) a stage that has not started and holds no accepted work or money.

    Без миграции нового статуса `cancelled` нет (StageStatus — enum в БД), поэтому
    отмена не начатого этапа = удаление с записью в журнале активности. Этап,
    который начат или за которым есть приёмки/платежи/чеки/расходы/замечания, не
    удаляется: ValueError("stage_delete_blocked") с причинами в `.args[1]`.
    """
    from app.models.entities import WorkDependency
    from app.models.work_schedule import ProjectWorkScheduleItem

    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        await _require_structure_actor(db, project=project, actor=actor)
        blockers: list[dict] = []
        if _status(stage) != StageStatus.planned:
            blockers.append(
                {
                    "code": "stage_already_started",
                    "message": "Этап уже начат или завершён — отменить его нельзя",
                    "status": _status(stage).value,
                }
            )
        blockers.extend(await _stage_deletion_blockers(db, stage))
        if blockers:
            raise StageDeleteBlocked(blockers)
        name = stage.name
        # Зависимые этапы и записи графика освобождаем явно: на SQLite FK не
        # всегда каскадят, а оставленная ссылка блокировала бы старт навсегда.
        for dependent in (
            await db.execute(
                select(Stage).where(
                    Stage.project_id == project.id,
                    Stage.depends_on_stage_id == stage.id,
                )
            )
        ).scalars().all():
            dependent.depends_on_stage_id = None
        for dep in (
            await db.execute(
                select(WorkDependency).where(
                    (WorkDependency.stage_id == stage.id)
                    | (WorkDependency.depends_on_stage_id == stage.id)
                )
            )
        ).scalars().all():
            await db.delete(dep)
        for item in (
            await db.execute(
                select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.stage_id == stage.id)
            )
        ).scalars().all():
            item.stage_id = None
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageCancelled",
            title=f"Отменён этап: {name}",
        )
        await db.flush()
        await db.delete(stage)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await _dispatch(db, "stage.delete")
    return {"ok": True, "id": stage_id, "name": name}


class StageDeleteBlocked(ValueError):
    def __init__(self, blockers: list[dict]):
        super().__init__("stage_delete_blocked")
        self.blockers = blockers


async def set_assignee(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    assignee_id: str | None,
) -> StageMutationResult | None:
    """Назначить исполнителя этапа из бригады ведущего (или снять назначение).

    Назначает ведущий/прораб (право расписания). Исполнитель — сам ведущий либо
    участник его бригады, не наблюдатель. `None` возвращает этап ведущему.
    """
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
        if is_self_managed_project(project):
            raise ValueError("stage_assignee_invalid")
        if _status(stage) in {StageStatus.review, StageStatus.done}:
            raise ValueError("stage_configuration_locked")
        if assignee_id is not None and assignee_id != project.contractor_id:
            membership = await team_service.project_team_membership(
                db, user_id=assignee_id, contractor_id=project.contractor_id
            )
            if membership is None or membership.role not in {"owner", "foreman", "member"}:
                raise ValueError("stage_assignee_invalid")
        if stage.assignee_id == assignee_id:
            await db.commit()
            return StageMutationResult(stage, True)
        stage.assignee_id = assignee_id
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageAssigneeChanged",
            title=f"Изменён исполнитель этапа: {stage.name}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(stage)
    await _dispatch(db, "stage.assignee")
    return StageMutationResult(stage, False)


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
        if stage.depends_on_stage_id == depends_on_stage_id and not (
            depends_on_stage_id is None and await _has_active_work_dependency(db, stage.id)
        ):
            await db.commit()
            return StageMutationResult(stage, True)
        previous = stage.depends_on_stage_id
        stage.depends_on_stage_id = depends_on_stage_id
        if depends_on_stage_id is None:
            # Снять зависимость — значит снять и записи WorkDependency из `sync`:
            # иначе старт продолжал бы отвечать `blocked` (STG-010).
            await _waive_work_dependencies(db, stage_id=stage.id)
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
            customer_link = "/(customer)/(tabs)/repair?tab=control"
            contractor_link = "/(contractor)/(tabs)/repair?tab=works"
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
                    "link_path": customer_link if is_self_managed_customer(project, actor) else contractor_link,
                },
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    if count:
        await _dispatch(db, "stage.dependencies.sync")
    return count
