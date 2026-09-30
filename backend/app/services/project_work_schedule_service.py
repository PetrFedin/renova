from app.core.timeutil import utc_now
from datetime import date

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, StageStatus, User
from app.models.work_schedule import (
    ProjectWorkSchedule,
    ProjectWorkScheduleItem,
    WorkScheduleItemStatus,
    WorkScheduleStatus,
)
from app.schemas.project_work_schedule import WorkScheduleCreateIn, WorkScheduleItemIn, WorkScheduleUpdateIn
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import clear_request_side_effect_context

WORK_SCHEDULE_CREATE_SCOPE = "work_schedule.create"


def is_project_member(user: User, project: Project) -> bool:
    return user.id in [project.customer_id, project.contractor_id]


def is_project_customer(user: User, project: Project) -> bool:
    return user.id == project.customer_id


async def can_manage_schedule(db: AsyncSession, user: User, project: Project) -> bool:
    """W66/W72: график — contractor owner/foreman; без подрядчика — заказчик; viewer/member — нет."""
    if user.id == project.contractor_id:
        return True
    if not project.contractor_id and user.id == project.customer_id:
        return True
    from app.services.team_service import team_role_for_project

    role = await team_role_for_project(db, user, project)
    return role in ("owner", "foreman")


async def load_items(db: AsyncSession, schedule_id: str) -> list[ProjectWorkScheduleItem]:
    return list(
        (
            await db.execute(
                select(ProjectWorkScheduleItem)
                .where(ProjectWorkScheduleItem.schedule_id == schedule_id)
                .order_by(
                    ProjectWorkScheduleItem.sort_order.asc(),
                    ProjectWorkScheduleItem.planned_start_date.asc(),
                )
            )
        ).scalars().all()
    )


async def attach_items(db: AsyncSession, schedule: ProjectWorkSchedule) -> ProjectWorkSchedule:
    schedule.items = await load_items(db, schedule.id)
    return schedule


async def require_project_member(db: AsyncSession, user: User, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not is_project_member(user, project):
        raise HTTPException(status_code=403, detail="project_forbidden")
    return project


async def _reload_project(db: AsyncSession, project_id: str) -> Project:
    """Re-fetch the authoritative Project row, bypassing the identity map.

    #462/#420: the caller may hold a `Project` obtained before any await
    below; re-fetching with `populate_existing=True` forces the ORM to
    refresh attributes so a concurrent contractor/customer reassignment
    cannot ride through on a stale in-memory instance.
    """
    query = select(Project).where(Project.id == project_id).execution_options(populate_existing=True)
    fresh = (await db.execute(query)).scalar_one_or_none()
    if fresh is None or getattr(fresh, "trashed_at", None):
        raise HTTPException(status_code=403, detail="work_schedule_project_authority_stale")
    return fresh


async def _require_manage_authority(db: AsyncSession, *, project: Project, user: User, forbidden_detail: str) -> None:
    from app.services.team_service import can_access_project

    if not await can_access_project(db, user, project, write=True):
        raise HTTPException(status_code=403, detail="work_schedule_project_authority_stale")
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail=forbidden_detail)


async def _validate_item_stage_ref(db: AsyncSession, *, project_id: str, stage_id: str | None) -> None:
    """#481: a non-null stage_id must belong to the path project, or 404."""
    if stage_id is None:
        return
    stage = await db.get(Stage, stage_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=404, detail="work_schedule_item_stage_not_found")


def _reject_dependency_on_create(item: WorkScheduleItemIn) -> None:
    """#481: a newly created schedule has no stable persisted item identity
    to depend on yet, so accepting a dependency at create time is unsafe."""
    if item.depends_on_item_id is not None:
        raise HTTPException(status_code=422, detail="work_schedule_dependency_create_not_supported")


async def _validate_dependency_ref_for_replace(
    db: AsyncSession, *, project_id: str, schedule_id: str, depends_on_item_id: str
) -> None:
    """#481: full replacement deletes the entire existing item set, so a
    dependency pointing at an old row of the *same* schedule is a dangling
    reference the moment the replacement runs. Missing/foreign items 404
    (privacy-preserving); an existing same-schedule item is a distinct,
    explicit 422 because that identity is about to be deleted."""
    dep = await db.get(ProjectWorkScheduleItem, depends_on_item_id)
    if dep is None or dep.project_id != project_id or dep.schedule_id != schedule_id:
        raise HTTPException(status_code=404, detail="work_schedule_dependency_not_found")
    raise HTTPException(status_code=422, detail="work_schedule_dependency_replace_not_supported")


async def _validate_items_for_create(db: AsyncSession, *, project_id: str, items: list[WorkScheduleItemIn]) -> None:
    for item in items:
        await _validate_item_stage_ref(db, project_id=project_id, stage_id=item.stage_id)
        _reject_dependency_on_create(item)


async def _validate_items_for_replace(
    db: AsyncSession, *, project_id: str, schedule_id: str, items: list[WorkScheduleItemIn]
) -> None:
    for item in items:
        await _validate_item_stage_ref(db, project_id=project_id, stage_id=item.stage_id)
        if item.depends_on_item_id is not None:
            await _validate_dependency_ref_for_replace(
                db, project_id=project_id, schedule_id=schedule_id, depends_on_item_id=item.depends_on_item_id
            )


def canonical_work_schedule_item_payload(item: WorkScheduleItemIn) -> dict:
    return {
        "stage_id": item.stage_id,
        "title": item.title,
        "description": item.description,
        "planned_start_date": item.planned_start_date.isoformat(),
        "planned_finish_date": item.planned_finish_date.isoformat(),
        "depends_on_item_id": item.depends_on_item_id,
        "requires_customer_acceptance": item.requires_customer_acceptance,
        "requires_photo": item.requires_photo,
        "requires_hidden_work_acceptance": item.requires_hidden_work_acceptance,
        "sort_order": item.sort_order,
    }


def canonical_work_schedule_create_payload(
    *,
    title: str,
    description: str | None,
    planned_start_date: date | None,
    planned_finish_date: date | None,
    items: list[WorkScheduleItemIn],
) -> dict:
    return {
        "title": title,
        "description": description,
        "planned_start_date": planned_start_date.isoformat() if planned_start_date else None,
        "planned_finish_date": planned_finish_date.isoformat() if planned_finish_date else None,
        "items": [canonical_work_schedule_item_payload(item) for item in items],
    }


def stage_status_to_schedule_status(stage: Stage) -> WorkScheduleItemStatus:
    if stage.status == StageStatus.active:
        return WorkScheduleItemStatus.in_progress
    if stage.status == StageStatus.review:
        return WorkScheduleItemStatus.submitted
    if stage.status == StageStatus.done:
        return WorkScheduleItemStatus.accepted
    if getattr(stage, "needs_rework", False):
        return WorkScheduleItemStatus.blocked
    return WorkScheduleItemStatus.planned


def calculate_delay(item: ProjectWorkScheduleItem) -> int:
    if item.status in [WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled]:
        return item.delay_days or 0
    if item.planned_finish_date < date.today():
        return max((date.today() - item.planned_finish_date).days, item.delay_days or 0)
    return item.delay_days or 0


async def sync_items_from_stages(db: AsyncSession, schedule: ProjectWorkSchedule) -> None:
    """Populate or refresh editable draft items from stages.

    This helper is intentionally called only by explicit write paths. Read endpoints
    must never rewrite a submitted or confirmed schedule behind the user's back.
    """
    stages = list(
        (
            await db.execute(
                select(Stage)
                .where(Stage.project_id == schedule.project_id)
                .order_by(Stage.sort_order.asc())
            )
        ).scalars().all()
    )
    existing = {item.stage_id: item for item in await load_items(db, schedule.id) if item.stage_id}
    start = schedule.planned_start_date or date.today()

    for index, stage in enumerate(stages):
        item = existing.get(stage.id)
        planned_start = stage.planned_start or start
        planned_finish = stage.planned_end or planned_start
        if item:
            item.title = stage.name
            item.planned_start_date = planned_start
            item.planned_finish_date = planned_finish
            item.status = stage_status_to_schedule_status(stage)
            item.progress_percent = stage.percent_complete or 0
            item.delay_days = calculate_delay(item)
            item.sort_order = stage.sort_order
            item.updated_at = utc_now()
        else:
            db.add(
                ProjectWorkScheduleItem(
                    schedule_id=schedule.id,
                    project_id=schedule.project_id,
                    stage_id=stage.id,
                    title=stage.name,
                    description=stage.notes,
                    status=stage_status_to_schedule_status(stage),
                    planned_start_date=planned_start,
                    planned_finish_date=planned_finish,
                    progress_percent=stage.percent_complete or 0,
                    sort_order=stage.sort_order if stage.sort_order is not None else index,
                    created_at=utc_now(),
                    updated_at=utc_now(),
                )
            )


async def create_item(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    body: WorkScheduleItemIn,
    index: int,
) -> None:
    db.add(
        ProjectWorkScheduleItem(
            schedule_id=schedule.id,
            project_id=schedule.project_id,
            stage_id=body.stage_id,
            title=body.title,
            description=body.description,
            planned_start_date=body.planned_start_date,
            planned_finish_date=body.planned_finish_date,
            depends_on_item_id=body.depends_on_item_id,
            requires_customer_acceptance=body.requires_customer_acceptance,
            requires_photo=body.requires_photo,
            requires_hidden_work_acceptance=body.requires_hidden_work_acceptance,
            sort_order=body.sort_order or index,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
    )


async def list_schedules(db: AsyncSession, project_id: str) -> list[ProjectWorkSchedule]:
    rows = list(
        (
            await db.execute(
                select(ProjectWorkSchedule)
                .where(ProjectWorkSchedule.project_id == project_id)
                .order_by(ProjectWorkSchedule.created_at.desc())
            )
        ).scalars().all()
    )
    for row in rows:
        await attach_items(db, row)
    return rows


async def get_active_schedule(db: AsyncSession, project: Project) -> ProjectWorkSchedule | None:
    """Return the current schedule without mutating schedule or stage truth."""
    schedule = (
        await db.execute(
            select(ProjectWorkSchedule)
            .where(ProjectWorkSchedule.project_id == project.id)
            .where(ProjectWorkSchedule.status != WorkScheduleStatus.archived)
            .order_by(ProjectWorkSchedule.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if schedule:
        await attach_items(db, schedule)
    return schedule


async def get_schedule(
    db: AsyncSession,
    project_id: str,
    schedule_id: str,
) -> ProjectWorkSchedule | None:
    schedule = (
        await db.execute(
            select(ProjectWorkSchedule)
            .where(ProjectWorkSchedule.project_id == project_id)
            .where(ProjectWorkSchedule.id == schedule_id)
        )
    ).scalar_one_or_none()
    if schedule:
        await attach_items(db, schedule)
    return schedule


async def create_schedule(
    db: AsyncSession,
    project: Project,
    user: User,
    body: WorkScheduleCreateIn,
    *,
    client_request_id: str | None = None,
) -> tuple[ProjectWorkSchedule, bool]:
    """Create exactly one schedule per client_request_id (#462/#420).

    Stage/dependency references on the incoming items are validated against
    the path project before anything is materialized (#481). The schedule
    row, its initial items and the ClientWriteRequest ledger entry commit in
    a single transaction, so a response lost after the server commit replays
    into the original schedule instead of minting a duplicate that could win
    `get_active_schedule()`'s "latest wins" selection.
    """
    from app.services.team_service import can_access_project

    if not await can_access_project(db, user, project, write=True):
        raise HTTPException(status_code=403, detail="only_project_members_can_create_schedule")
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_create_schedule")

    await _validate_items_for_create(db, project_id=project.id, items=body.items)

    payload = canonical_work_schedule_create_payload(
        title=body.title,
        description=body.description,
        planned_start_date=body.planned_start_date,
        planned_finish_date=body.planned_finish_date,
        items=body.items,
    )

    replay_id = await replay_entity_id(
        db,
        scope=WORK_SCHEDULE_CREATE_SCOPE,
        project_id=project.id,
        user_id=user.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        existing = await get_schedule(db, project_id=project.id, schedule_id=replay_id)
        if not existing:
            raise HTTPException(status_code=404, detail="work_schedule_idempotency_target_missing")
        return existing, True

    # #420: recheck authority against a freshly loaded Project right before
    # materializing the schedule so a revocation that lands while the checks
    # above were running cannot ride through on a stale authorization.
    fresh_project = await _reload_project(db, project.id)
    await _require_manage_authority(
        db,
        project=fresh_project,
        user=user,
        forbidden_detail="only_contractor_or_foreman_can_create_schedule",
    )

    schedule = ProjectWorkSchedule(
        project_id=fresh_project.id,
        title=body.title,
        description=body.description,
        planned_start_date=body.planned_start_date or fresh_project.planned_start_date,
        planned_finish_date=body.planned_finish_date or fresh_project.planned_end_date,
        created_by=user.id,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(schedule)
    await db.flush()
    try:
        if body.items:
            for index, item in enumerate(body.items):
                await create_item(db, schedule, item, index)
        else:
            await sync_items_from_stages(db, schedule)
        await db.flush()
        created, canonical_id = await commit_client_write(
            db,
            scope=WORK_SCHEDULE_CREATE_SCOPE,
            project_id=fresh_project.id,
            user_id=user.id,
            request_id=client_request_id,
            payload=payload,
            entity_id=schedule.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await get_schedule(db, project_id=fresh_project.id, schedule_id=canonical_id)
        if not existing:
            raise HTTPException(status_code=404, detail="work_schedule_idempotency_target_missing")
        return existing, True

    await db.refresh(schedule)
    return await attach_items(db, schedule), False


async def update_schedule(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    user: User,
    body: WorkScheduleUpdateIn,
) -> ProjectWorkSchedule:
    # P0: submitted/confirmed frozen until reject→draft
    if schedule.status == WorkScheduleStatus.confirmed:
        raise HTTPException(status_code=409, detail="confirmed_schedule_cannot_be_edited")
    if schedule.status == WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="submitted_schedule_cannot_be_edited")
    project = await db.get(Project, schedule.project_id)
    if project and not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_edit_schedule")
    if body.items is not None:
        # #481: validate every new item's stage/dependency reference against
        # this schedule's project *before* any metadata is mutated or the
        # previous item set is deleted — a validation failure must leave the
        # original schedule and item set completely intact.
        await _validate_items_for_replace(
            db, project_id=schedule.project_id, schedule_id=schedule.id, items=body.items
        )
    if body.title is not None:
        schedule.title = body.title
    if body.description is not None:
        schedule.description = body.description
    if body.planned_start_date is not None:
        schedule.planned_start_date = body.planned_start_date
    if body.planned_finish_date is not None:
        schedule.planned_finish_date = body.planned_finish_date
    if body.items is not None:
        await db.execute(
            delete(ProjectWorkScheduleItem).where(
                ProjectWorkScheduleItem.schedule_id == schedule.id
            )
        )
        for index, item in enumerate(body.items):
            await create_item(db, schedule, item, index)
    schedule.status = (
        WorkScheduleStatus.draft
        if schedule.status == WorkScheduleStatus.rejected
        else schedule.status
    )
    schedule.updated_at = utc_now()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def sync_stages_from_schedule_items(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
) -> int:
    """W46: после confirm даты items → stages (одно направление, SCHEDULE-SOT)."""
    items = await load_items(db, schedule.id)
    updated = 0
    for item in items:
        if not item.stage_id:
            continue
        stage = await db.get(Stage, item.stage_id)
        if not stage or stage.project_id != schedule.project_id:
            continue
        stage.planned_start = item.planned_start_date
        stage.planned_end = item.planned_finish_date
        updated += 1
    await db.flush()
    return updated


async def _prepare_schedule_effects(
    db: AsyncSession,
    *,
    schedule: ProjectWorkSchedule,
    actor_id: str,
    activity_kind: str,
    activity_title: str,
    activity_body: str | None,
    link_path: str,
    notification_target: str | None,
    notification_type: str,
    notification_title: str,
    notification_body: str,
    return_to: str,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="work_schedule",
        aggregate_id=schedule.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": schedule.project_id,
            "user_id": actor_id,
            "kind": activity_kind,
            "title": activity_title,
            "body": activity_body,
            "link_path": link_path,
        },
    )
    if notification_target and notification_target != actor_id:
        await outbox.enqueue(
            db,
            aggregate_type="work_schedule",
            aggregate_id=schedule.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": notification_target,
                "project_id": schedule.project_id,
                "notification_type": notification_type,
                "title": notification_title,
                "body": notification_body,
                "link_path": link_path,
                "return_to": return_to,
            },
        )


async def _dispatch_schedule_effects(db: AsyncSession, *, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def submit_schedule(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    user: User,
) -> tuple[ProjectWorkSchedule, bool]:
    """Submit once per legal transition; a repeat submit replays (#462/#420).

    The schedule row is row-locked and re-read before any state check so two
    concurrent submits (or a response-loss retry racing a fresh attempt)
    serialize instead of double-applying the transition. Authority is
    rechecked against a freshly loaded Project after that lock wait.
    Submitting an already-submitted schedule is the same target state the
    caller asked for, so it replays the current row untouched — it does not
    bump `schedule_version`/`submitted_at` or re-emit `ScheduleSubmitted`
    evidence a second time. Submitting from any other illegal source state
    (e.g. an already-confirmed schedule) fails deterministically with 409
    instead of silently re-submitting.
    """
    from app.services.team_service import can_access_project

    lock_query = select(ProjectWorkSchedule).where(
        ProjectWorkSchedule.id == schedule.id,
        ProjectWorkSchedule.project_id == schedule.project_id,
    )
    try:
        lock_query = lock_query.with_for_update()
    except Exception:
        pass
    locked = (await db.execute(lock_query)).scalar_one_or_none()
    if locked is None:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    schedule = locked

    project = await _reload_project(db, schedule.project_id)
    if not await can_access_project(db, user, project, write=True):
        raise HTTPException(status_code=403, detail="project_forbidden")
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_submit_schedule")

    if schedule.status == WorkScheduleStatus.submitted:
        return await attach_items(db, schedule), True
    if schedule.status not in (WorkScheduleStatus.draft, WorkScheduleStatus.rejected):
        raise HTTPException(status_code=409, detail="work_schedule_submit_invalid_state")

    items = await load_items(db, schedule.id)
    if not items:
        raise HTTPException(status_code=409, detail="schedule_items_required")

    prev = int(getattr(schedule, "schedule_version", None) or 1)
    if schedule.status == WorkScheduleStatus.rejected or (
        schedule.submitted_at is not None and schedule.status == WorkScheduleStatus.draft
    ):
        schedule.schedule_version = prev + 1
    elif not getattr(schedule, "schedule_version", None):
        schedule.schedule_version = 1
    schedule.status = WorkScheduleStatus.submitted
    schedule.submitted_by = user.id
    schedule.submitted_at = utc_now()
    schedule.updated_at = utc_now()

    try:
        await _prepare_schedule_effects(
            db,
            schedule=schedule,
            actor_id=user.id,
            activity_kind="ScheduleSubmitted",
            activity_title=f"График на согласование: {schedule.title}",
            activity_body=None,
            link_path="/(customer)/(tabs)/calendar",
            notification_target=project.customer_id,
            notification_type="schedule_review",
            notification_title="Согласуйте план-график",
            notification_body=schedule.title,
            return_to="/(customer)/(tabs)/",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(schedule)
    await _dispatch_schedule_effects(db, source="work_schedule.submit")
    return await attach_items(db, schedule), False


async def confirm_schedule(
    db: AsyncSession,
    project: Project,
    schedule: ProjectWorkSchedule,
    user: User,
) -> ProjectWorkSchedule:
    if not is_project_customer(user, project):
        raise HTTPException(status_code=403, detail="only_customer_can_confirm_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_confirm")

    schedule.status = WorkScheduleStatus.confirmed
    schedule.confirmed_by = user.id
    schedule.confirmed_at = utc_now()
    schedule.updated_at = utc_now()

    try:
        await sync_stages_from_schedule_items(db, schedule)
        await _prepare_schedule_effects(
            db,
            schedule=schedule,
            actor_id=user.id,
            activity_kind="ScheduleConfirmed",
            activity_title=f"График согласован: {schedule.title}",
            activity_body=None,
            link_path="/(contractor)/(tabs)/calendar",
            notification_target=project.contractor_id,
            notification_type="schedule_confirmed",
            notification_title="План-график согласован",
            notification_body=schedule.title,
            return_to="/(contractor)/(tabs)/",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(schedule)
    await _dispatch_schedule_effects(db, source="work_schedule.confirm")
    return await attach_items(db, schedule)


async def reject_schedule(
    db: AsyncSession,
    project: Project,
    schedule: ProjectWorkSchedule,
    user: User,
    reason: str | None,
) -> ProjectWorkSchedule:
    if not is_project_customer(user, project):
        raise HTTPException(status_code=403, detail="only_customer_can_reject_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_reject")

    schedule.status = WorkScheduleStatus.rejected
    schedule.rejection_reason = reason
    schedule.rejected_by = user.id
    schedule.rejected_at = utc_now()
    schedule.updated_at = utc_now()

    try:
        await _prepare_schedule_effects(
            db,
            schedule=schedule,
            actor_id=user.id,
            activity_kind="ScheduleRejected",
            activity_title=f"График отклонён: {schedule.title}",
            activity_body=reason,
            link_path="/(contractor)/(tabs)/calendar",
            notification_target=project.contractor_id,
            notification_type="schedule_rejected",
            notification_title="План-график на доработку",
            notification_body=reason or schedule.title,
            return_to="/(contractor)/(tabs)/",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(schedule)
    await _dispatch_schedule_effects(db, source="work_schedule.reject")
    return await attach_items(db, schedule)


async def mark_schedule_items_accepted_for_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> int:
    """После finalize_work_acceptance — отразить приёмку в SoT графика (не наоборот)."""
    rows = list(
        (
            await db.execute(
                select(ProjectWorkScheduleItem)
                .where(ProjectWorkScheduleItem.project_id == project_id)
                .where(ProjectWorkScheduleItem.stage_id == stage_id)
                .where(ProjectWorkScheduleItem.status != WorkScheduleItemStatus.cancelled)
            )
        ).scalars().all()
    )
    now = utc_now()
    today = date.today()
    updated = 0
    for item in rows:
        if item.status == WorkScheduleItemStatus.accepted:
            continue
        item.status = WorkScheduleItemStatus.accepted
        item.progress_percent = 100
        if not item.actual_finish_date:
            item.actual_finish_date = today
        item.delay_days = calculate_delay(item)
        item.updated_at = now
        updated += 1
    return updated


async def sync_stage_from_item_status(
    db: AsyncSession,
    item: ProjectWorkScheduleItem,
    status: WorkScheduleItemStatus,
) -> None:
    if not item.stage_id:
        return
    stage = await db.get(Stage, item.stage_id)
    if not stage or stage.project_id != item.project_id:
        return

    stage.needs_rework = status == WorkScheduleItemStatus.blocked
    if status == WorkScheduleItemStatus.planned:
        stage.status = StageStatus.planned
        stage.percent_complete = min(stage.percent_complete or 0, 10)
    elif status in [WorkScheduleItemStatus.ready, WorkScheduleItemStatus.in_progress]:
        stage.status = StageStatus.active
        stage.actual_start = stage.actual_start or date.today()
        stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 25)
    elif status == WorkScheduleItemStatus.submitted:
        stage.status = StageStatus.review
        stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 90)
    elif status == WorkScheduleItemStatus.accepted:
        # P0: done только при реальной приёмке заказчика (не по одному статусу этапа)
        if stage.customer_accepted_at:
            stage.status = StageStatus.done
            stage.percent_complete = 100
        else:
            stage.status = StageStatus.review
            stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 95)


async def update_item_status(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    item: ProjectWorkScheduleItem,
    body_status: WorkScheduleItemStatus,
    *,
    user: User,
    project: Project,
    blocking_reason: str | None = None,
    progress_percent: float | None = None,
) -> ProjectWorkScheduleItem:
    """Смена статуса строки графика.

    P0: status=accepted — только заказчик и только после единой приёмки (customer_accepted_at).
    Исполнитель сдаёт работу через submitted → stage.review → work-acceptances.
    """
    from app.services.schedule_item_transitions import assert_item_transition

    await assert_item_transition(
        db,
        user=user,
        project=project,
        from_status=item.status,
        to_status=body_status,
    )
    if body_status == WorkScheduleItemStatus.accepted:
        if not is_project_customer(user, project):
            raise HTTPException(status_code=403, detail="only_customer_can_set_schedule_item_accepted")
        if item.stage_id:
            stage = await db.get(Stage, item.stage_id)
            if not stage or stage.project_id != project.id:
                raise HTTPException(status_code=409, detail="schedule_item_stage_missing")
            if not stage.customer_accepted_at:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "use_work_acceptance_first",
                        "message": "Приёмка этапа — только через «Приёмка» (фото и чеклист), не из графика",
                    },
                )
        elif getattr(item, "requires_customer_acceptance", False):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "use_work_acceptance_first",
                    "message": "Строка требует приёмку заказчика — сначала завершите приёмку этапа",
                },
            )

    item.status = body_status
    item.blocking_reason = blocking_reason
    if progress_percent is not None:
        item.progress_percent = progress_percent
    if body_status == WorkScheduleItemStatus.in_progress and not item.actual_start_date:
        item.actual_start_date = date.today()
    if (
        body_status in [WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled]
        and not item.actual_finish_date
    ):
        item.actual_finish_date = date.today()
    if body_status == WorkScheduleItemStatus.accepted:
        item.progress_percent = max(item.progress_percent or 0, 100)
    item.delay_days = calculate_delay(item)
    item.updated_at = utc_now()
    await sync_stage_from_item_status(db, item, body_status)
    await db.commit()
    await db.refresh(item)
    return item
