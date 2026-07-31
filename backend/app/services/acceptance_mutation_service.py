"""Atomic request/return transitions for work acceptance."""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    AcceptanceStatus,
    Project,
    ProjectIssue,
    Stage,
    StageStatus,
    WorkAcceptance,
)
from app.services import outbox_service as outbox
from app.services.accept_orchestrator import project_member_ids


class AcceptanceNotFound(RuntimeError):
    pass


class AcceptanceAlreadyDecided(RuntimeError):
    pass


class StageAlreadyAccepted(RuntimeError):
    pass


@dataclass(frozen=True)
class AcceptanceMutationResult:
    acceptance: WorkAcceptance
    created: bool = False


def _member_return_to(project: Project, member_id: str) -> str:
    if member_id == project.customer_id:
        return "/(customer)/(tabs)/home"
    return "/(contractor)/(tabs)/home"


async def _lock_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> Stage:
    query = select(Stage).where(
        Stage.id == stage_id,
        Stage.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    stage = (await db.execute(query)).scalar_one_or_none()
    if stage is None:
        raise AcceptanceNotFound("stage_not_found")
    return stage


async def _enqueue_request_effects(
    db: AsyncSession,
    *,
    row: WorkAcceptance,
    project: Project,
    stage: Stage,
    requested_by: str,
    comment: str | None,
) -> None:
    await outbox.enqueue_once(
        db,
        parent_outbox_id=row.id,
        effect_key="acceptance-requested:activity",
        aggregate_type="work_acceptance",
        aggregate_id=row.id,
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
    for member_id in project_member_ids(project):
        if member_id == requested_by:
            continue
        await outbox.enqueue_once(
            db,
            parent_outbox_id=row.id,
            effect_key=f"acceptance-requested:notification:{member_id}",
            aggregate_type="work_acceptance",
            aggregate_id=row.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "stage_review",
                "title": f"Этап ждёт приёмки: {stage.name}",
                "body": comment or "Проверьте результат работ и примите решение.",
                "link_path": f"/stage/{stage.id}",
                "return_to": _member_return_to(project, member_id),
            },
        )


async def _enqueue_return_effects(
    db: AsyncSession,
    *,
    row: WorkAcceptance,
    project: Project,
    stage: Stage,
    returned_by: str,
    comment: str | None,
    source: str,
) -> None:
    suffix = " (портал)" if source == "portal" else ""
    await outbox.enqueue_once(
        db,
        parent_outbox_id=row.id,
        effect_key="acceptance-returned:activity",
        aggregate_type="work_acceptance",
        aggregate_id=row.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": returned_by,
            "kind": "AcceptanceReturned",
            "title": f"Этап возвращён на доработку{suffix}: {stage.name}",
            "body": comment,
            "link_path": f"/stage/{stage.id}",
        },
    )
    for member_id in project_member_ids(project):
        if member_id == returned_by:
            continue
        await outbox.enqueue_once(
            db,
            parent_outbox_id=row.id,
            effect_key=f"acceptance-returned:notification:{member_id}",
            aggregate_type="work_acceptance",
            aggregate_id=row.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "stage_review",
                "title": f"Доработка по этапу: {stage.name}",
                "body": comment or "Этап возвращён после проверки.",
                "link_path": f"/stage/{stage.id}",
                "return_to": _member_return_to(project, member_id),
            },
        )


async def request_acceptance_with_effects(
    db: AsyncSession,
    *,
    project: Project,
    stage_id: str,
    requested_by: str,
    checklist: list[str] | None,
    comment: str | None,
) -> AcceptanceMutationResult:
    """Create one active request and its durable effects in one transaction."""
    try:
        stage = await _lock_stage(
            db,
            project_id=project.id,
            stage_id=stage_id,
        )
        if stage.status == StageStatus.done:
            raise StageAlreadyAccepted("stage_already_accepted")

        query = (
            select(WorkAcceptance)
            .where(
                WorkAcceptance.project_id == project.id,
                WorkAcceptance.stage_id == stage.id,
                WorkAcceptance.status.in_([
                    AcceptanceStatus.requested.value,
                    AcceptanceStatus.in_review.value,
                ]),
            )
            .order_by(WorkAcceptance.created_at.desc())
            .limit(1)
        )
        try:
            query = query.with_for_update()
        except Exception:
            pass
        existing = (await db.execute(query)).scalar_one_or_none()
        if existing is not None:
            await db.rollback()
            return AcceptanceMutationResult(existing, created=False)

        now = utc_now()
        row = WorkAcceptance(
            project_id=project.id,
            room_id=None,
            stage_id=stage.id,
            requested_by=requested_by,
            requested_at=now,
            status=AcceptanceStatus.requested.value,
            checklist_json=json.dumps(checklist or []),
            comment=comment,
            created_at=now,
        )
        stage.status = StageStatus.review
        stage.contractor_ready = True
        stage.contractor_ready_at = stage.contractor_ready_at or now
        stage.percent_complete = max(stage.percent_complete or 0, 90)
        db.add(row)
        await db.flush()
        await _enqueue_request_effects(
            db,
            row=row,
            project=project,
            stage=stage,
            requested_by=requested_by,
            comment=comment,
        )
        await db.commit()
        await db.refresh(row)
        return AcceptanceMutationResult(row, created=True)
    except (AcceptanceNotFound, StageAlreadyAccepted):
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise


async def return_acceptance_with_effects(
    db: AsyncSession,
    *,
    project: Project,
    acceptance_id: str,
    returned_by: str,
    checklist: list[str] | None,
    quality_score: float | None,
    comment: str | None,
    create_issue: bool,
    source: str,
) -> AcceptanceMutationResult:
    """Return one pending acceptance exactly once with all durable effects."""
    try:
        existing = await db.get(WorkAcceptance, acceptance_id)
        if existing is None or existing.project_id != project.id:
            raise AcceptanceNotFound("acceptance_not_found")
        stage = await _lock_stage(
            db,
            project_id=project.id,
            stage_id=existing.stage_id,
        )

        values: dict[str, object] = {
            "status": AcceptanceStatus.returned.value,
            "accepted_by": returned_by,
            "quality_score": quality_score,
            "comment": comment or existing.comment,
        }
        if checklist is not None:
            values["checklist_json"] = json.dumps(checklist)

        claimed = await db.execute(
            update(WorkAcceptance)
            .where(
                WorkAcceptance.id == acceptance_id,
                WorkAcceptance.project_id == project.id,
                WorkAcceptance.status.in_([
                    AcceptanceStatus.requested.value,
                    AcceptanceStatus.in_review.value,
                ]),
            )
            .values(**values)
            .returning(WorkAcceptance.id)
        )
        if claimed.first() is None:
            await db.rollback()
            raise AcceptanceAlreadyDecided("acceptance_already_decided")

        stage.status = StageStatus.active
        stage.contractor_ready = False
        stage.contractor_ready_at = None
        stage.needs_rework = True
        stage.percent_complete = min(stage.percent_complete or 90, 90)

        if create_issue:
            db.add(
                ProjectIssue(
                    project_id=project.id,
                    stage_id=stage.id,
                    title=f"Доработка по этапу: {stage.name}",
                    description=comment,
                    severity="medium",
                    status="open",
                    created_at=utc_now(),
                )
            )

        await db.flush()
        row = await db.get(WorkAcceptance, acceptance_id)
        if row is None:
            raise AcceptanceNotFound("acceptance_not_found")
        await _enqueue_return_effects(
            db,
            row=row,
            project=project,
            stage=stage,
            returned_by=returned_by,
            comment=comment,
            source=source,
        )
        await db.commit()
        await db.refresh(row)
        return AcceptanceMutationResult(row, created=False)
    except (AcceptanceNotFound, AcceptanceAlreadyDecided):
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise
