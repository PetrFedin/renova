"""Atomic stage review submission and rework transitions."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timeutil import utc_now
from app.models.entities import (
    Project,
    ProjectIssue,
    Stage,
    StageComment,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import outbox_service as outbox
from app.services import workflow_service as workflow
from app.services.stage_service import parse_room_ids

REWORK_SLA_DAYS = 3


@dataclass(frozen=True)
class StageReviewResult:
    stage: Stage
    acceptance: WorkAcceptance
    replayed: bool
    issue_id: str | None = None


def _stage_status(stage: Stage) -> StageStatus:
    return stage.status if isinstance(stage.status, StageStatus) else StageStatus(str(stage.status))


def _is_self_managed_project(project: Project) -> bool:
    return project.contractor_id is None


def _is_self_managed_customer(project: Project, actor: User) -> bool:
    return (
        _is_self_managed_project(project)
        and actor.role == UserRole.customer
        and actor.id == project.customer_id
    )


async def _locked_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> Stage | None:
    query = (
        select(Stage)
        .where(Stage.id == stage_id, Stage.project_id == project_id)
        .options(selectinload(Stage.comments), selectinload(Stage.photos))
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _latest_acceptance(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> WorkAcceptance | None:
    query = (
        select(WorkAcceptance)
        .where(
            WorkAcceptance.project_id == project_id,
            WorkAcceptance.stage_id == stage_id,
        )
        .order_by(WorkAcceptance.created_at.desc(), WorkAcceptance.id.desc())
        .limit(1)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


def _executor_ids(project: Project, stage: Stage) -> list[str]:
    if stage.assignee_id:
        return [stage.assignee_id]
    if _is_self_managed_project(project) and project.customer_id:
        return [project.customer_id]
    return [project.contractor_id] if project.contractor_id else []


def _require_submit_actor(project: Project, stage: Stage, actor: User) -> None:
    if _is_self_managed_customer(project, actor) and actor.id in _executor_ids(project, stage):
        return
    if actor.role != UserRole.contractor or actor.id not in _executor_ids(project, stage):
        raise ValueError("stage_submit_actor_forbidden")


def _require_reject_actor(project: Project, actor: User) -> None:
    if actor.role != UserRole.customer or actor.id != project.customer_id:
        raise ValueError("stage_reject_actor_forbidden")


async def _enqueue_activity(
    db: AsyncSession,
    *,
    stage: Stage,
    actor_id: str,
    kind: str,
    title: str,
    body: str | None = None,
    link_path: str | None = None,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="stage_review",
        aggregate_id=stage.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": stage.project_id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "work_type": stage.work_type,
            "link_path": link_path or f"/stage/{stage.id}",
        },
    )


async def _enqueue_notification(
    db: AsyncSession,
    *,
    stage: Stage,
    user_id: str,
    title: str,
    body: str,
    return_to: str,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="stage_review",
        aggregate_id=stage.id,
        event_type=outbox.NOTIFICATION_EVENT,
        payload={
            "user_id": user_id,
            "project_id": stage.project_id,
            "notification_type": "stage_review",
            "title": title,
            "body": body,
            "link_path": f"/stage/{stage.id}",
            "return_to": return_to,
        },
    )


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def submit_for_review(
    db: AsyncSession,
    *,
    project: Project,
    stage_id: str,
    actor: User,
    comment: str | None = None,
) -> tuple[StageReviewResult | None, dict | None]:
    """Move one assigned active stage to review with its acceptance and evidence."""
    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None, None
    try:
        _require_submit_actor(project, stage, actor)
    except ValueError:
        await db.rollback()
        raise

    acceptance = await _latest_acceptance(
        db,
        project_id=project.id,
        stage_id=stage.id,
    )
    current = _stage_status(stage)
    if (
        current == StageStatus.review
        and stage.contractor_ready
        and acceptance is not None
        and acceptance.status in {"requested", "in_review"}
    ):
        await db.commit()
        return StageReviewResult(stage, acceptance, True), None
    if current != StageStatus.active:
        await db.rollback()
        raise ValueError(f"stage_submit_invalid_status:{current.value}")

    from app.services import work_snapshot_service as snapshots

    completion = await snapshots.completion_check(db, stage, project)
    if not completion.get("ok"):
        await db.rollback()
        return None, {"code": "completion_gate", "completion": completion}

    clean_comment = (comment or "").strip() or None
    try:
        checklist = workflow.stage_checklist(stage)
        checklist_json = json.dumps(checklist, ensure_ascii=False)
        progress = workflow.checklist_progress(checklist)
        now = utc_now()
        stage.checklist_json = checklist_json
        stage.percent_complete = float(progress)
        stage.contractor_ready = True
        stage.contractor_ready_at = now
        stage.status = StageStatus.review
        stage.actual_end = stage.actual_end or date.today()
        stage.needs_rework = False
        stage.rework_deadline = None

        room_ids = parse_room_ids(stage)
        room_id = room_ids[0] if room_ids else None
        if acceptance is None:
            acceptance = WorkAcceptance(
                project_id=project.id,
                room_id=room_id,
                stage_id=stage.id,
                requested_by=actor.id,
                requested_at=now,
                status="requested",
                checklist_json=checklist_json,
                comment=clean_comment,
            )
            db.add(acceptance)
        else:
            acceptance.room_id = room_id
            acceptance.requested_by = actor.id
            acceptance.requested_at = now
            acceptance.status = "requested"
            acceptance.checklist_json = checklist_json
            acceptance.accepted_by = None
            acceptance.accepted_at = None
            acceptance.quality_score = None
            acceptance.comment = clean_comment

        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="WorkCompleted",
            title=f"Завершено: {stage.name}",
            body=clean_comment,
        )
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="InspectionRequested",
            title=f"Запрошена приёмка: {stage.name}",
            body=clean_comment,
            link_path="/(customer)/(tabs)/repair?tab=control",
        )
        if project.customer_id and project.customer_id != actor.id:
            await _enqueue_notification(
                db,
                stage=stage,
                user_id=project.customer_id,
                title="Этап на приёмке",
                body=clean_comment or stage.name,
                return_to="/(customer)/(tabs)/repair?tab=control",
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(stage)
    await db.refresh(acceptance)
    await _dispatch(db, "stage.review.submit")
    return StageReviewResult(stage, acceptance, False), None


def _append_rework_item(stage: Stage, reason: str) -> float:
    checklist = workflow.stage_checklist(stage)
    checklist.append(
        {
            "id": f"rework-{uuid.uuid4().hex[:16]}",
            "title": f"Устранить замечание: {reason[:180]}",
            "done": False,
        }
    )
    stage.checklist_json = json.dumps(checklist, ensure_ascii=False)
    progress = workflow.checklist_progress(checklist)
    stage.percent_complete = float(progress)
    return progress


async def reject_for_rework(
    db: AsyncSession,
    *,
    project: Project,
    stage_id: str,
    actor: User,
    reason: str,
    expected_acceptance_id: str | None = None,
    quality_score: float | None = None,
    create_issue: bool = False,
) -> StageReviewResult | None:
    """Return one reviewed stage to work with SLA, checklist task and durable evidence."""
    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise ValueError("stage_rejection_reason_required")
    if len(clean_reason) > 2000:
        raise ValueError("stage_rejection_reason_too_long")

    stage = await _locked_stage(db, project_id=project.id, stage_id=stage_id)
    if stage is None:
        await db.rollback()
        return None
    try:
        _require_reject_actor(project, actor)
    except ValueError:
        await db.rollback()
        raise

    acceptance = await _latest_acceptance(
        db,
        project_id=project.id,
        stage_id=stage.id,
    )
    if expected_acceptance_id and (
        acceptance is None or acceptance.id != expected_acceptance_id
    ):
        await db.rollback()
        raise ValueError("acceptance_not_current")

    current = _stage_status(stage)
    if (
        current == StageStatus.active
        and stage.needs_rework
        and acceptance is not None
        and acceptance.status == "returned"
    ):
        await db.commit()
        return StageReviewResult(stage, acceptance, True)
    if current != StageStatus.review:
        await db.rollback()
        raise ValueError(f"stage_reject_invalid_status:{current.value}")

    issue: ProjectIssue | None = None
    try:
        now = utc_now()
        deadline = now + timedelta(days=REWORK_SLA_DAYS)
        _append_rework_item(stage, clean_reason)
        stage.status = StageStatus.active
        stage.contractor_ready = False
        stage.contractor_ready_at = None
        stage.actual_end = None
        stage.needs_rework = True
        stage.rework_deadline = deadline

        if acceptance is None:
            room_ids = parse_room_ids(stage)
            acceptance = WorkAcceptance(
                project_id=project.id,
                room_id=room_ids[0] if room_ids else None,
                stage_id=stage.id,
                requested_by=next(iter(_executor_ids(project, stage)), None),
                requested_at=now,
                accepted_by=actor.id,
                accepted_at=now,
                status="returned",
                checklist_json=stage.checklist_json,
                quality_score=quality_score,
                comment=clean_reason,
            )
            db.add(acceptance)
        else:
            acceptance.status = "returned"
            acceptance.comment = clean_reason
            acceptance.accepted_by = actor.id
            acceptance.accepted_at = now
            acceptance.quality_score = quality_score
            acceptance.checklist_json = stage.checklist_json

        if create_issue:
            room_ids = parse_room_ids(stage)
            executors = _executor_ids(project, stage)
            issue = ProjectIssue(
                project_id=project.id,
                room_id=room_ids[0] if room_ids else None,
                stage_id=stage.id,
                title=f"Доработка по этапу: {stage.name}",
                description=clean_reason,
                severity="medium",
                status="open",
                assignee_id=executors[0] if executors else None,
                due_at=deadline,
                created_at=now,
            )
            db.add(issue)

        db.add(
            StageComment(
                stage_id=stage.id,
                user_id=actor.id,
                author_role="customer",
                text=f"Отклонено: {clean_reason}",
            )
        )
        await _enqueue_activity(
            db,
            stage=stage,
            actor_id=actor.id,
            kind="StageReworkRequested",
            title=f"Этап возвращён на доработку: {stage.name}",
            body=f"{clean_reason}\nSLA: {REWORK_SLA_DAYS} дн.",
        )
        for executor_id in _executor_ids(project, stage):
            if executor_id != actor.id:
                await _enqueue_notification(
                    db,
                    stage=stage,
                    user_id=executor_id,
                    title=f"Этап отклонён · SLA {REWORK_SLA_DAYS} дн.",
                    body=f"{stage.name}: {clean_reason}. Срок до {deadline.date().isoformat()}",
                    return_to="/(contractor)/(tabs)/plan",
                )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(stage)
    await db.refresh(acceptance)
    if issue is not None:
        await db.refresh(issue)
    await _dispatch(db, "stage.review.reject")
    return StageReviewResult(
        stage,
        acceptance,
        False,
        issue_id=issue.id if issue is not None else None,
    )
