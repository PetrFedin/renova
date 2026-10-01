"""Transactional side effects for work-acceptance state transitions."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, WorkAcceptance
from app.services import outbox_service as outbox


async def _member_ids(db: AsyncSession, project: Project, stage: Stage) -> list[str]:
    """Заказчик, ведущий, назначенные на этап члены команды, прораб, технадзор (COM-005)."""
    from app.services import notification_recipients as recipients_svc

    return await recipients_svc.project_member_ids_for(
        db, project, recipients_svc.QUALITY, stage_id=stage.id
    )


async def prepare_request_effects(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    acceptance: WorkAcceptance,
    requested_by: str,
    comment: str | None,
) -> list[str]:
    """Enqueue request activity and member notifications in the state transaction."""
    event_ids: list[str] = []
    activity = await outbox.enqueue(
        db,
        aggregate_type="work_acceptance",
        aggregate_id=acceptance.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": requested_by,
            "kind": "AcceptanceRequested",
            "title": f"Этап на приёмке: {stage.name}",
            "body": comment,
            "link_path": f"/stage/{stage.id}",
        },
    )
    event_ids.append(activity.id)

    for member_id in await _member_ids(db, project, stage):
        if member_id == requested_by:
            continue
        notification = await outbox.enqueue(
            db,
            aggregate_type="work_acceptance",
            aggregate_id=acceptance.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "stage_review",
                "title": f"Этап ждёт приёмки: {stage.name}",
                "body": comment or "Проверьте результат работ и примите решение.",
                "link_path": f"/stage/{stage.id}",
                "return_to": "/(customer)/(tabs)/",
            },
        )
        event_ids.append(notification.id)
    return event_ids


async def prepare_return_effects(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    acceptance: WorkAcceptance,
    returned_by: str,
    comment: str | None,
) -> list[str]:
    """Enqueue rework activity and member notifications in the state transaction."""
    event_ids: list[str] = []
    activity = await outbox.enqueue(
        db,
        aggregate_type="work_acceptance",
        aggregate_id=acceptance.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": returned_by,
            "kind": "AcceptanceReturned",
            "title": f"Этап возвращён на доработку: {stage.name}",
            "body": comment,
            "link_path": f"/stage/{stage.id}",
        },
    )
    event_ids.append(activity.id)

    for member_id in await _member_ids(db, project, stage):
        if member_id == returned_by:
            continue
        notification = await outbox.enqueue(
            db,
            aggregate_type="work_acceptance",
            aggregate_id=acceptance.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "stage_review",
                "title": f"Доработка по этапу: {stage.name}",
                "body": comment or "Этап возвращён после проверки.",
                "link_path": f"/stage/{stage.id}",
                "return_to": "/(customer)/(tabs)/",
            },
        )
        event_ids.append(notification.id)
    return event_ids
