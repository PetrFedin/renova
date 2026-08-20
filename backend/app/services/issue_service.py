"""Замечания и дефекты Renova OS — статусы, проверка ролей и reopen."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, ProjectIssue, UserRole
from app.services import outbox_service as outbox

ISSUE_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress", "fixed"},
    "assigned": {"in_progress", "fixed"},
    "in_progress": {"fixed"},
    "fixed": {"closed", "open"},
    "review": {"closed", "open"},
    "closed": {"open"},
    "rejected": set(),
}

_BOTH_ROLES = {UserRole.customer.value, UserRole.contractor.value}
ISSUE_ROLE_ALLOWED: dict[tuple[str, str], set[str]] = {
    ("open", "in_progress"): {UserRole.contractor.value},
    ("assigned", "in_progress"): {UserRole.contractor.value},
    ("open", "fixed"): {UserRole.contractor.value},
    ("assigned", "fixed"): {UserRole.contractor.value},
    ("in_progress", "fixed"): {UserRole.contractor.value},
    ("fixed", "closed"): {UserRole.customer.value},
    ("review", "closed"): {UserRole.customer.value},
    ("fixed", "open"): {UserRole.customer.value},
    ("review", "open"): {UserRole.customer.value},
    ("closed", "open"): {UserRole.customer.value},
}


def role_value(role: UserRole | str) -> str:
    return role.value if hasattr(role, "value") else str(role)


def issue_dict(issue: ProjectIssue) -> dict:
    return {
        "id": issue.id,
        "project_id": issue.project_id,
        "room_id": issue.room_id,
        "stage_id": issue.stage_id,
        "title": issue.title,
        "description": issue.description,
        "severity": issue.severity,
        "status": issue.status,
        "assignee_id": issue.assignee_id,
        "due_at": issue.due_at.isoformat() if issue.due_at else None,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "closed_at": issue.closed_at.isoformat() if issue.closed_at else None,
        "floor_plan_id": issue.floor_plan_id,
        "x_pct": issue.x_pct,
        "y_pct": issue.y_pct,
        "photo_key": issue.photo_key,
        "photo_url": f"/api/v1/media/{issue.photo_key}" if issue.photo_key else None,
    }


async def list_issues(
    db: AsyncSession,
    project_id: str,
    status: str | None = None,
) -> list[ProjectIssue]:
    query = select(ProjectIssue).where(ProjectIssue.project_id == project_id)
    if status:
        query = query.where(ProjectIssue.status == status)
    result = await db.execute(query.order_by(ProjectIssue.created_at.desc()))
    return list(result.scalars().all())


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


def validate_issue_transition(
    current: str,
    target: str,
    actor_role: UserRole | str,
) -> None:
    if target not in ISSUE_TRANSITIONS.get(current, set()):
        raise ValueError(f"invalid_issue_transition:{current}:{target}")
    if role_value(actor_role) not in ISSUE_ROLE_ALLOWED.get((current, target), set()):
        raise ValueError("issue_transition_role_forbidden")


def validate_issue_status_change(current: str, target: str) -> bool:
    """Fail-closed проверка для legacy callers без role context."""
    return target in ISSUE_TRANSITIONS.get(current, set())


async def transition_issue(
    db: AsyncSession,
    issue: ProjectIssue,
    target: str,
    actor_role: UserRole | str,
    *,
    commit: bool = True,
) -> ProjectIssue:
    """Apply a valid transition; callers may compose it into a wider transaction."""
    validate_issue_transition(issue.status, target, actor_role)
    issue.status = target
    issue.closed_at = datetime.now(timezone.utc) if target == "closed" else None
    if commit:
        await db.commit()
        await db.refresh(issue)
    return issue


async def update_issue_status(
    db: AsyncSession,
    issue_id: str,
    status: str,
) -> ProjectIssue | None:
    """Legacy status write, но только по допустимому графу — без bypass open → closed."""
    issue = await db.get(ProjectIssue, issue_id)
    if not issue or not validate_issue_status_change(issue.status, status):
        return None
    issue.status = status
    issue.closed_at = datetime.now(timezone.utc) if status == "closed" else None
    await db.commit()
    await db.refresh(issue)
    return issue


def issue_transition_targets(project: Project, actor_id: str) -> list[str]:
    return sorted(
        {
            user_id
            for user_id in (project.customer_id, project.contractor_id)
            if user_id and user_id != actor_id
        }
    )


def issue_transition_event(current: str, target: str) -> tuple[str, str]:
    if target == "in_progress":
        return "IssueStarted", "Исполнитель начал исправление"
    if target == "fixed":
        return "IssueFixed", "Исправление отмечено — требуется проверка заказчика"
    if target == "closed":
        return "IssueClosed", "Заказчик подтвердил устранение"
    if target == "open" and current == "closed":
        return "IssueReopened", "Закрытое замечание открыто снова"
    if target == "open":
        return "IssueReturned", "Замечание возвращено на доработку"
    return "IssueUpdated", f"Статус: {current} → {target}"


def issue_transition_notification(
    current: str,
    target: str,
    title: str,
) -> tuple[str, str, str]:
    if target == "in_progress":
        return "issue", f"Исправление начато: {title}", "Исполнитель приступил к устранению замечания."
    if target == "fixed":
        return "issue", f"Исправлено: {title}", "Проверьте результат и подтвердите устранение."
    if target == "closed":
        return "issue", f"Закрыто: {title}", "Заказчик подтвердил устранение замечания."
    if target == "open" and current == "closed":
        return "issue", f"Открыто снова: {title}", "Замечание повторно открыто заказчиком."
    if target == "open":
        return "issue", f"На доработку: {title}", "Заказчик не подтвердил исправление."
    return "issue", f"Статус замечания: {title}", f"{current} → {target}"


async def prepare_issue_transition_effects(
    db: AsyncSession,
    *,
    project: Project,
    issue: ProjectIssue,
    actor_id: str,
    previous_status: str,
) -> None:
    """Enqueue audit and member notifications in the issue state transaction."""
    event_kind, event_body = issue_transition_event(previous_status, issue.status)
    await outbox.enqueue(
        db,
        aggregate_type="project_issue",
        aggregate_id=issue.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": issue.project_id,
            "user_id": actor_id,
            "kind": event_kind,
            "title": issue.title,
            "body": f"{previous_status} → {issue.status}. {event_body}",
            "room_id": issue.room_id,
            "stage_id": issue.stage_id,
            "link_path": "/control",
        },
    )

    notification_type, title, message = issue_transition_notification(
        previous_status,
        issue.status,
        issue.title,
    )
    for target_id in issue_transition_targets(project, actor_id):
        await outbox.enqueue(
            db,
            aggregate_type="project_issue",
            aggregate_id=issue.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": target_id,
                "project_id": issue.project_id,
                "notification_type": notification_type,
                "title": title,
                "body": message,
                "link_path": "/control",
                "return_to": None,
            },
        )
