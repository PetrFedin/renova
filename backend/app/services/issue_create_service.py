"""Replay-safe ProjectIssue creation for #417 / parent #316."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, ProjectIssue, User
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "issue.create"


def canonical_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Canonicalize the persisted create contract without using payload equality as identity."""
    return {
        "title": str(payload.get("title") or ""),
        "description": payload.get("description"),
        "room_id": payload.get("room_id"),
        "stage_id": payload.get("stage_id"),
        "severity": payload.get("severity", "medium"),
        "floor_plan_id": payload.get("floor_plan_id"),
        "x_pct": payload.get("x_pct"),
        "y_pct": payload.get("y_pct"),
        "photo_key": payload.get("photo_key"),
    }


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    """Serialize issue-create replay checks before any candidate row is materialized."""
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise RuntimeError("issue_project_missing")
    return project


async def _revalidate_authority(
    db: AsyncSession,
    *,
    user_id: str,
    project: Project,
) -> User:
    """Re-check write/capability truth after any wait on the project lock."""
    from fastapi import HTTPException
    from app.services import team_service as team_svc

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if not await team_svc.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")
    await team_svc.require_capability(db, actor, project, "field_write")
    return actor


async def _replay(db: AsyncSession, *, project_id: str, issue_id: str) -> ProjectIssue:
    row = await db.get(ProjectIssue, issue_id)
    if row is None or row.project_id != project_id:
        raise RuntimeError("issue_replay_corrupt")
    return row


async def create_issue(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[ProjectIssue, bool]:
    canonical = canonical_payload(payload)
    project_id = project.id

    # The project row lock serializes same-project issue creation. All lock,
    # authority and replay work stays inside one rollback boundary so service
    # callers cannot accidentally retain a lock after an authorization error.
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_authority(db, user_id=user_id, project=project)
        replay_id = await replay_entity_id(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
        )
        if replay_id:
            replayed = await _replay(db, project_id=project_id, issue_id=replay_id)
            await db.commit()  # release the authority/project lock for direct callers
            return replayed, True

        issue = ProjectIssue(
            project_id=project_id,
            room_id=canonical["room_id"],
            stage_id=canonical["stage_id"],
            title=canonical["title"],
            description=canonical["description"],
            severity=canonical["severity"],
            status="open",
            due_at=utc_now() + timedelta(days=3),
            floor_plan_id=canonical["floor_plan_id"],
            x_pct=canonical["x_pct"],
            y_pct=canonical["y_pct"],
            photo_key=canonical["photo_key"],
        )
        db.add(issue)
        await db.flush()

        await outbox.enqueue(
            db,
            aggregate_type="project_issue",
            aggregate_id=issue.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "IssueCreated",
                "title": issue.title,
                "body": issue.severity,
                "link_path": "/control",
            },
        )

        notify_targets = {
            uid
            for uid in (project.customer_id, project.contractor_id)
            if uid and uid != user_id
        }
        for target_id in sorted(notify_targets):
            await outbox.enqueue(
                db,
                aggregate_type="project_issue",
                aggregate_id=issue.id,
                event_type=outbox.NOTIFICATION_EVENT,
                payload={
                    "user_id": target_id,
                    "project_id": project_id,
                    "notification_type": "issue",
                    "title": f"Новое замечание: {issue.title}",
                    "body": issue.description or issue.severity,
                    "link_path": "/control",
                    "return_to": None,
                },
            )

        created, entity_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=issue.id,
        )
        if not created:
            replayed = await _replay(db, project_id=project_id, issue_id=entity_id)
            await db.commit()
            return replayed, True
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(issue)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="issue.create", limit=10)
    return issue, False
