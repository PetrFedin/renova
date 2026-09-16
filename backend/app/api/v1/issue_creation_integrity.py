"""P0 #316: replay-safe, project-scoped QC issue creation."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.models.entities import FloorPlan, ProjectIssue, Room, Stage, User
from app.services import issue_service as issue_svc
from app.services import outbox_service as outbox
from app.services import team_service as team_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(tags=["renova-os"])
ISSUE_CREATE_SCOPE = "issue.create"


class IssueCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    room_id: str | None = None
    stage_id: str | None = None
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    floor_plan_id: str | None = None
    x_pct: float | None = Field(default=None, ge=0, le=100)
    y_pct: float | None = Field(default=None, ge=0, le=100)
    photo_key: str | None = Field(default=None, max_length=512)
    client_request_id: str = Field(min_length=8, max_length=80)


def _idempotency_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


async def _validate_project_references(
    db: AsyncSession,
    project_id: str,
    body: IssueCreateIn,
) -> None:
    if body.room_id:
        room = await db.scalar(
            select(Room).where(Room.id == body.room_id, Room.project_id == project_id)
        )
        if not room:
            raise HTTPException(404, detail={"code": "room_not_found"})
    if body.stage_id:
        stage = await db.scalar(
            select(Stage).where(Stage.id == body.stage_id, Stage.project_id == project_id)
        )
        if not stage:
            raise HTTPException(404, detail={"code": "stage_not_found"})
    if body.floor_plan_id:
        floor_plan = await db.scalar(
            select(FloorPlan).where(
                FloorPlan.id == body.floor_plan_id,
                FloorPlan.project_id == project_id,
            )
        )
        if not floor_plan:
            raise HTTPException(404, detail={"code": "floor_plan_not_found"})


async def _prepare_effects(db: AsyncSession, project, issue: ProjectIssue, actor_id: str) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="project_issue",
        aggregate_id=issue.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": issue.project_id,
            "user_id": actor_id,
            "kind": "IssueCreated",
            "title": issue.title,
            "body": issue.severity,
            "room_id": issue.room_id,
            "stage_id": issue.stage_id,
            "link_path": "/control",
        },
    )
    targets = sorted(
        {
            uid
            for uid in (project.customer_id, project.contractor_id)
            if uid and uid != actor_id
        }
    )
    for uid in targets:
        await outbox.enqueue(
            db,
            aggregate_type="project_issue",
            aggregate_id=issue.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": uid,
                "project_id": issue.project_id,
                "notification_type": "issue",
                "title": f"Новое замечание: {issue.title}",
                "body": issue.description or issue.severity,
                "link_path": "/control",
                "return_to": None,
            },
        )


@router.post("/projects/{project_id}/issues")
async def create_issue_integrity(
    project_id: str,
    body: IssueCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    await team_svc.require_capability(db, user, project, "field_write")
    await _validate_project_references(db, project_id, body)

    clean_title = body.title.strip()
    if not clean_title:
        raise HTTPException(422, detail={"code": "empty_title"})
    payload = {
        "title": clean_title,
        "description": body.description,
        "room_id": body.room_id,
        "stage_id": body.stage_id,
        "severity": body.severity,
        "floor_plan_id": body.floor_plan_id,
        "x_pct": body.x_pct,
        "y_pct": body.y_pct,
        "photo_key": body.photo_key,
    }

    try:
        replay_id = await replay_entity_id(
            db,
            scope=ISSUE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as error:
        raise _idempotency_error() from error

    if replay_id:
        replayed = await db.get(ProjectIssue, replay_id)
        if not replayed or replayed.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        response = issue_svc.issue_dict(replayed)
        response["idempotent_replay"] = True
        return response

    issue = ProjectIssue(
        project_id=project_id,
        room_id=body.room_id,
        stage_id=body.stage_id,
        title=clean_title,
        description=body.description,
        severity=body.severity,
        status="open",
        due_at=utc_now() + timedelta(days=3),
        floor_plan_id=body.floor_plan_id,
        x_pct=body.x_pct,
        y_pct=body.y_pct,
        photo_key=body.photo_key,
    )
    db.add(issue)
    try:
        await db.flush()
        await _prepare_effects(db, project, issue, user.id)
        created, entity_id = await commit_client_write(
            db,
            scope=ISSUE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=issue.id,
        )
    except IdempotencyConflict as error:
        await db.rollback()
        raise _idempotency_error() from error
    except BaseException:
        await db.rollback()
        raise

    if not created:
        issue = await db.get(ProjectIssue, entity_id)
        if not issue or issue.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    else:
        await db.refresh(issue)
        from app.services.outbox_inline_dispatch import dispatch_best_effort

        await dispatch_best_effort(db, source="issue.create", limit=10)

    response = issue_svc.issue_dict(issue)
    response["idempotent_replay"] = not created
    return response
