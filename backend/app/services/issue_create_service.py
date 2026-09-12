"""Replay-safe ProjectIssue creation for #417 / parent #316."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, ProjectIssue
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

    replay_id = await replay_entity_id(
        db,
        scope=SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=canonical,
    )
    if replay_id:
        return await _replay(db, project_id=project_id, issue_id=replay_id), True

    issue = ProjectIssue(
        project_id=project_id,
        room_id=canonical["room_id"],
        stage_id=canonical["stage_id"],
        title=canonical["title"],
        description=canonical["description"],
        severity=canonical["severity"],
        status="open",
        due_at=datetime.now(timezone.utc) + timedelta(days=3),
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
            "room_id": issue.room_id,
            "stage_id": issue.stage_id,
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

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=issue.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        return await _replay(db, project_id=project_id, issue_id=entity_id), True

    await db.refresh(issue)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="issue.create", limit=10)
    return issue, False
