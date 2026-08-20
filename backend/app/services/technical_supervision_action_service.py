from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import FloorPlan, Project, ProjectIssue, Room, Stage, User
from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
from app.services import outbox_service as outbox
from app.services import project_work_schedule_service as schedule_svc
from app.services import technical_supervision_service as supervision


async def active_supervisor_user_id(
    db: AsyncSession,
    project_id: str,
) -> str | None:
    row = await supervision.active_assignment(db, project_id)
    if row is None:
        return None
    if not await supervision.is_active_supervisor(
        db,
        project_id=project_id,
        user_id=row.representative_user_id,
    ):
        return None
    return row.representative_user_id


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def create_quality_issue(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    title: str,
    description: str | None = None,
    room_id: str | None = None,
    stage_id: str | None = None,
    severity: str = "medium",
    floor_plan_id: str | None = None,
    x_pct: float | None = None,
    y_pct: float | None = None,
    photo_key: str | None = None,
) -> ProjectIssue:
    await supervision.require_capability(
        db,
        user=actor,
        project=project,
        capability="quality_issue_write",
    )
    clean_title = " ".join((title or "").strip().split())
    clean_description = (description or "").strip() or None
    normalized_severity = (severity or "medium").strip().lower()
    if not clean_title or len(clean_title) > 255:
        raise HTTPException(422, "quality_issue_title_invalid")
    if normalized_severity not in {"low", "medium", "high", "critical"}:
        raise HTTPException(422, "quality_issue_severity_invalid")
    if room_id:
        room = await db.get(Room, room_id)
        if room is None or room.project_id != project.id:
            raise HTTPException(404, "quality_issue_room_not_found")
    if stage_id:
        stage = await db.get(Stage, stage_id)
        if stage is None or stage.project_id != project.id:
            raise HTTPException(404, "quality_issue_stage_not_found")
    if floor_plan_id:
        plan = await db.get(FloorPlan, floor_plan_id)
        if plan is None or plan.project_id != project.id:
            raise HTTPException(404, "quality_issue_floor_plan_not_found")
    for coordinate in (x_pct, y_pct):
        if coordinate is not None and not 0 <= float(coordinate) <= 100:
            raise HTTPException(422, "quality_issue_coordinates_invalid")

    issue = ProjectIssue(
        project_id=project.id,
        room_id=room_id,
        stage_id=stage_id,
        title=clean_title,
        description=clean_description,
        severity=normalized_severity,
        status="open",
        due_at=utc_now() + timedelta(days=3),
        floor_plan_id=floor_plan_id,
        x_pct=x_pct,
        y_pct=y_pct,
        photo_key=photo_key,
    )
    db.add(issue)
    try:
        await db.flush()
        await outbox.enqueue(
            db,
            aggregate_type="project_issue",
            aggregate_id=issue.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project.id,
                "user_id": actor.id,
                "kind": "IssueCreated",
                "title": issue.title,
                "body": issue.description or issue.severity,
                "room_id": issue.room_id,
                "stage_id": issue.stage_id,
                "link_path": "/control",
            },
        )
        for target_id in {project.customer_id, project.contractor_id}:
            if target_id and target_id != actor.id:
                await outbox.enqueue(
                    db,
                    aggregate_type="project_issue",
                    aggregate_id=issue.id,
                    event_type=outbox.NOTIFICATION_EVENT,
                    payload={
                        "user_id": target_id,
                        "project_id": project.id,
                        "notification_type": "issue",
                        "title": f"Новое замечание: {issue.title}",
                        "body": issue.description or issue.severity,
                        "link_path": "/control",
                        "return_to": None,
                    },
                )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(issue)
    await _dispatch(db, "technical_supervision.issue.create")
    return issue


async def reject_schedule_as_reviewer(
    db: AsyncSession,
    *,
    project: Project,
    schedule: ProjectWorkSchedule,
    actor: User,
    reason: str | None,
) -> ProjectWorkSchedule:
    reviewer_mode = await supervision.require_capability(
        db,
        user=actor,
        project=project,
        capability="schedule_review",
    )
    if reviewer_mode != "supervisor":
        return await schedule_svc.reject_schedule(
            db,
            project=project,
            schedule=schedule,
            user=actor,
            reason=reason,
        )
    if schedule.project_id != project.id:
        raise HTTPException(404, "work_schedule_not_found")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(409, "schedule_must_be_submitted_before_reject")
    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise HTTPException(422, "schedule_rejection_reason_required")

    schedule.status = WorkScheduleStatus.rejected
    schedule.rejection_reason = clean_reason
    schedule.rejected_by = actor.id
    schedule.rejected_at = utc_now()
    schedule.updated_at = utc_now()
    try:
        await schedule_svc._prepare_schedule_effects(
            db,
            schedule=schedule,
            actor_id=actor.id,
            activity_kind="ScheduleRejectedByTechnicalSupervisor",
            activity_title=f"Технадзор вернул график на доработку: {schedule.title}",
            activity_body=clean_reason,
            link_path="/(contractor)/(tabs)/calendar",
            notification_target=project.contractor_id,
            notification_type="schedule_rejected",
            notification_title="План-график на доработку от технадзора",
            notification_body=clean_reason,
            return_to="/(contractor)/(tabs)/home",
        )
        if project.customer_id and project.customer_id != actor.id:
            await outbox.enqueue(
                db,
                aggregate_type="work_schedule",
                aggregate_id=schedule.id,
                event_type=outbox.NOTIFICATION_EVENT,
                payload={
                    "user_id": project.customer_id,
                    "project_id": project.id,
                    "notification_type": "schedule_review",
                    "title": "Технадзор вернул график на доработку",
                    "body": clean_reason,
                    "link_path": "/calendar",
                    "return_to": None,
                },
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(schedule)
    await schedule_svc._dispatch_schedule_effects(
        db,
        source="technical_supervision.schedule.reject",
    )
    return await schedule_svc.attach_items(db, schedule)


async def notify_supervisor_chat_message(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    thread_id: str,
    thread_title: str,
    body: str,
) -> None:
    supervisor_id = await active_supervisor_user_id(db, project.id)
    if not supervisor_id or supervisor_id == actor_id:
        return
    # Existing chat service already notifies customer and contractor. Only the
    # independently appointed supervisor is added here to avoid duplicate sends.
    if supervisor_id in {project.customer_id, project.contractor_id}:
        return
    from app.services import notification_service as notification_svc

    await notification_svc.notify(
        db,
        user_id=supervisor_id,
        project_id=project.id,
        notification_type="chat_message",
        title=f"Новое сообщение: {thread_title}",
        body=body,
        link_path=f"/chat/{thread_id}",
        return_to="/(customer)/(tabs)/chat",
    )
    from app.api.v1.ws import broadcast_inbox

    await broadcast_inbox(
        supervisor_id,
        {
            "type": "inbox",
            "event": "message",
            "thread_id": thread_id,
            "project_id": project.id,
        },
    )
