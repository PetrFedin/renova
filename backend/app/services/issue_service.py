"""Замечания и дефекты Renova OS."""
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ProjectIssue


def issue_dict(i: ProjectIssue) -> dict:
    return {
        "id": i.id,
        "project_id": i.project_id,
        "room_id": i.room_id,
        "stage_id": i.stage_id,
        "title": i.title,
        "description": i.description,
        "severity": i.severity,
        "status": i.status,
        "assignee_id": i.assignee_id,
        "due_at": i.due_at.isoformat() if i.due_at else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "closed_at": i.closed_at.isoformat() if i.closed_at else None,
        "floor_plan_id": i.floor_plan_id,
        "x_pct": i.x_pct,
        "y_pct": i.y_pct,
        "photo_key": i.photo_key,
        "photo_url": f"/api/v1/media/{i.photo_key}" if i.photo_key else None,
    }


async def list_issues(db: AsyncSession, project_id: str, status: str | None = None) -> list[ProjectIssue]:
    q = select(ProjectIssue).where(ProjectIssue.project_id == project_id)
    if status:
        q = q.where(ProjectIssue.status == status)
    r = await db.execute(q.order_by(ProjectIssue.created_at.desc()))
    return list(r.scalars().all())


async def create_issue(
    db: AsyncSession,
    project_id: str,
    title: str,
    *,
    description: str | None = None,
    room_id: str | None = None,
    stage_id: str | None = None,
    severity: str = "medium",
    due_days: int = 3,
    floor_plan_id: str | None = None,
    x_pct: float | None = None,
    y_pct: float | None = None,
    photo_key: str | None = None,
) -> ProjectIssue:
    issue = ProjectIssue(
        project_id=project_id,
        room_id=room_id,
        stage_id=stage_id,
        title=title,
        description=description,
        severity=severity,
        status="open",
        due_at=datetime.now(timezone.utc) + timedelta(days=due_days),
        floor_plan_id=floor_plan_id,
        x_pct=x_pct,
        y_pct=y_pct,
        photo_key=photo_key,
    )
    db.add(issue)
    await db.commit()
    await db.refresh(issue)
    return issue


async def update_issue_status(db: AsyncSession, issue_id: str, status: str) -> ProjectIssue | None:
    issue = await db.get(ProjectIssue, issue_id)
    if not issue:
        return None
    issue.status = status
    if status == "closed":
        issue.closed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(issue)
    return issue
