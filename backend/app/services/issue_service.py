"""Замечания и дефекты Renova OS — статусы, проверка ролей и reopen."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import FloorPlan, Project, ProjectIssue, Room, Stage, UserRole
from app.services import outbox_inline_dispatch
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import clear_request_side_effect_context

ISSUE_CREATE_SCOPE = "issue.create"

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


SUPERVISOR_ROLE = "supervisor"
ISSUE_SEVERITIES = ("low", "medium", "high", "critical")
# Критичные и высокие замечания блокируют приёмку этапа и closeout; остальные — предупреждение.
BLOCKING_SEVERITIES = ("high", "critical")
ISSUE_TERMINAL_STATUS = "closed"
WARRANTY_PREFIX = "[Гарантия]"

# Технадзор проверяет исправление: подтверждает (fixed → closed), возвращает (→ open)
# и может открыть закрытое замечание снова. Исполнительные переходы ему недоступны.
SUPERVISOR_ISSUE_TRANSITIONS: set[tuple[str, str]] = {
    ("fixed", "closed"),
    ("review", "closed"),
    ("fixed", "open"),
    ("review", "open"),
    ("closed", "open"),
}

# Проект без исполнителя: заказчик сам исполнитель и сам проверяющий, отдельного шага
# «исправлено → проверено» нет — замечание закрывается сразу.
SELF_MANAGED_CUSTOMER_EXTRA: set[tuple[str, str]] = {
    ("open", "closed"),
    ("assigned", "closed"),
    ("in_progress", "closed"),
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


async def _validate_same_project_link(
    db: AsyncSession,
    *,
    model,
    entity_id: str | None,
    project_id: str,
    not_found_code: str,
) -> None:
    """Fail-closed: сущность должна существовать и принадлежать тому же project_id.

    Отсутствующая или чужая (другой проект) сущность трактуется одинаково —
    privacy-preserving 404, чтобы не палить наличие чужих объектов.
    """
    if entity_id is None:
        return
    entity = await db.get(model, entity_id)
    if entity is None or entity.project_id != project_id:
        raise ValueError(not_found_code)


async def validate_issue_links(
    db: AsyncSession,
    project_id: str,
    *,
    room_id: str | None = None,
    stage_id: str | None = None,
    floor_plan_id: str | None = None,
) -> None:
    """P0: room_id/stage_id/floor_plan_id переданные в Issue обязаны принадлежать
    тому же project_id, что и путь запроса — иначе можно связать замечание
    с чужим проектом (см. issue #474)."""
    await _validate_same_project_link(
        db, model=Room, entity_id=room_id, project_id=project_id,
        not_found_code="issue_room_not_found",
    )
    await _validate_same_project_link(
        db, model=Stage, entity_id=stage_id, project_id=project_id,
        not_found_code="issue_stage_not_found",
    )
    await _validate_same_project_link(
        db, model=FloorPlan, entity_id=floor_plan_id, project_id=project_id,
        not_found_code="issue_floor_plan_not_found",
    )


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
    await validate_issue_links(
        db, project_id, room_id=room_id, stage_id=stage_id, floor_plan_id=floor_plan_id,
    )
    issue = ProjectIssue(
        project_id=project_id,
        room_id=room_id,
        stage_id=stage_id,
        title=title,
        description=description,
        severity=severity,
        status="open",
        due_at=utc_now() + timedelta(days=due_days),
        floor_plan_id=floor_plan_id,
        x_pct=x_pct,
        y_pct=y_pct,
        photo_key=photo_key,
    )
    db.add(issue)
    await db.commit()
    await db.refresh(issue)
    return issue


def canonical_issue_create_payload(
    *,
    title: str,
    description: str | None,
    room_id: str | None,
    stage_id: str | None,
    severity: str,
    floor_plan_id: str | None,
    x_pct: float | None,
    y_pct: float | None,
    photo_key: str | None,
) -> dict:
    return {
        "title": title,
        "description": description,
        "room_id": room_id,
        "stage_id": stage_id,
        "severity": severity,
        "floor_plan_id": floor_plan_id,
        "x_pct": x_pct,
        "y_pct": y_pct,
        "photo_key": photo_key,
    }


async def create_or_replay_issue(
    db: AsyncSession,
    project_id: str,
    title: str,
    *,
    user_id: str,
    description: str | None = None,
    room_id: str | None = None,
    stage_id: str | None = None,
    severity: str = "medium",
    due_days: int = 3,
    floor_plan_id: str | None = None,
    x_pct: float | None = None,
    y_pct: float | None = None,
    photo_key: str | None = None,
    client_request_id: str | None = None,
) -> tuple[ProjectIssue, bool]:
    """Create exactly one ProjectIssue per client_request_id (#417).

    A lost response after the first commit must replay into the original
    ProjectIssue instead of creating a duplicate. The same request_id with a
    changed canonical payload raises IdempotencyConflict rather than silently
    overwriting the earlier defect's meaning. Distinct request_ids with
    byte-identical issue values remain distinct deliberate defects/remarks.
    The ProjectIssue, its activity DomainOutbox row(s), recipient
    notification DomainOutbox row(s) and the ClientWriteRequest ledger entry
    are all prepared and committed in a single transaction; inline delivery
    only happens after that commit.
    """
    await validate_issue_links(
        db, project_id, room_id=room_id, stage_id=stage_id, floor_plan_id=floor_plan_id,
    )
    payload = canonical_issue_create_payload(
        title=title,
        description=description,
        room_id=room_id,
        stage_id=stage_id,
        severity=severity,
        floor_plan_id=floor_plan_id,
        x_pct=x_pct,
        y_pct=y_pct,
        photo_key=photo_key,
    )
    try:
        replay_id = await replay_entity_id(
            db,
            scope=ISSUE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            existing = await db.get(ProjectIssue, replay_id)
            if not existing or existing.project_id != project_id:
                raise ValueError("issue_idempotency_target_missing")
            return existing, False

        issue = ProjectIssue(
            project_id=project_id,
            room_id=room_id,
            stage_id=stage_id,
            title=title,
            description=description,
            severity=severity,
            status="open",
            due_at=utc_now() + timedelta(days=due_days),
            floor_plan_id=floor_plan_id,
            x_pct=x_pct,
            y_pct=y_pct,
            photo_key=photo_key,
        )
        db.add(issue)
        await db.flush()
        created, canonical_issue_id = await commit_client_write(
            db,
            scope=ISSUE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=issue.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await db.get(ProjectIssue, canonical_issue_id)
        if not existing:
            raise ValueError("issue_idempotency_target_missing")
        return existing, False

    await db.refresh(issue)
    await outbox_inline_dispatch.dispatch_best_effort(db, source=ISSUE_CREATE_SCOPE, limit=4)
    return issue, True


def validate_issue_transition(
    current: str,
    target: str,
    actor_role: UserRole | str,
    *,
    self_managed: bool = False,
) -> None:
    role = role_value(actor_role)
    if role == UserRole.customer.value and self_managed and (current, target) in SELF_MANAGED_CUSTOMER_EXTRA:
        return
    if target not in ISSUE_TRANSITIONS.get(current, set()):
        raise ValueError(f"invalid_issue_transition:{current}:{target}")
    allowed = ISSUE_ROLE_ALLOWED.get((current, target), set())
    if role == SUPERVISOR_ROLE:
        if (current, target) in SUPERVISOR_ISSUE_TRANSITIONS:
            return
        raise ValueError("issue_transition_role_forbidden")
    if role == UserRole.customer.value and self_managed and UserRole.contractor.value in allowed:
        return
    if role not in allowed:
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
    self_managed: bool = False,
) -> ProjectIssue:
    """Apply a valid transition; callers may compose it into a wider transaction."""
    validate_issue_transition(issue.status, target, actor_role, self_managed=self_managed)
    issue.status = target
    issue.closed_at = utc_now() if target == "closed" else None
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
    issue.closed_at = utc_now() if status == "closed" else None
    await db.commit()
    await db.refresh(issue)
    return issue


def issue_transition_targets(
    project: Project,
    actor_id: str,
    *,
    supervisor_id: str | None = None,
) -> list[str]:
    return sorted(
        {
            user_id
            for user_id in (project.customer_id, project.contractor_id, supervisor_id)
            if user_id and user_id != actor_id
        }
    )


def normalize_severity(value: str | None) -> str:
    """422-совместимая нормализация: только low/medium/high/critical."""
    normalized = (value or "medium").strip().lower()
    if normalized not in ISSUE_SEVERITIES:
        raise ValueError("issue_severity_invalid")
    return normalized


def validate_issue_coordinates(x_pct: float | None, y_pct: float | None) -> None:
    for coordinate in (x_pct, y_pct):
        if coordinate is not None and not 0 <= float(coordinate) <= 100:
            raise ValueError("issue_coordinates_invalid")


def _issue_brief(issue: ProjectIssue) -> dict:
    return {
        "id": issue.id,
        "title": issue.title,
        "severity": issue.severity,
        "status": issue.status,
        "stage_id": issue.stage_id,
    }


async def open_issues_gate(
    db: AsyncSession,
    project_id: str,
    *,
    stage_id: str | None = None,
) -> dict:
    """Единый источник истины: какие открытые замечания блокируют приёмку этапа / closeout.

    `stage_id` задан — замечания этого этапа (гейт сдачи и приёмки); не задан — все
    замечания проекта (closeout). Гарантийные обращения учитывает отдельный контур
    (`warranty_open`), здесь их нет. Критичные и высокие — блок, низкие и средние —
    предупреждение.
    """
    query = select(ProjectIssue).where(
        ProjectIssue.project_id == project_id,
        ProjectIssue.status != ISSUE_TERMINAL_STATUS,
    )
    if stage_id:
        query = query.where(ProjectIssue.stage_id == stage_id)
    rows = [
        i
        for i in (await db.execute(query)).scalars().all()
        if not (i.title or "").startswith(WARRANTY_PREFIX)
    ]
    blocking = [i for i in rows if i.severity in BLOCKING_SEVERITIES]
    warnings = [i for i in rows if i.severity not in BLOCKING_SEVERITIES]
    return {
        "blocking": [_issue_brief(i) for i in blocking],
        "blocking_count": len(blocking),
        "warning_count": len(warnings),
        "warnings": [_issue_brief(i) for i in warnings],
    }


class OpenIssuesBlock(ValueError):
    """Приёмка этапа заблокирована открытыми критичными/высокими замечаниями."""

    code = "open_issues_block_acceptance"

    def __init__(self, gate: dict):
        super().__init__(self.code)
        self.gate = gate


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
    supervisor_id = None
    try:
        from app.services.technical_supervision_action_service import active_supervisor_user_id

        supervisor_id = await active_supervisor_user_id(db, project.id)
    except Exception:  # noqa: BLE001 — уведомление технадзору не должно ломать переход
        supervisor_id = None
    for target_id in issue_transition_targets(project, actor_id, supervisor_id=supervisor_id):
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
