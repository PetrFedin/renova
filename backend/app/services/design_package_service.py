"""Canonical design-package lifecycle with durable decision evidence."""
from __future__ import annotations

from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import DesignPackage, Project, User
from app.services import outbox_service as outbox

DesignAction = Literal["submit", "approve", "reject"]


def _target(action: DesignAction) -> str:
    return {
        "submit": "pending",
        "approve": "approved",
        "reject": "rejected",
    }[action]


def _validate_actor(project: Project, actor: User, action: DesignAction) -> None:
    if action == "submit":
        if actor.id not in {project.contractor_id, project.foreman_id}:
            raise ValueError("design_decision_actor_forbidden")
        return
    if actor.id != project.customer_id:
        raise ValueError("design_decision_actor_forbidden")


def _validate_transition(current: str, action: DesignAction) -> bool:
    target = _target(action)
    if current == target:
        return False
    allowed = {
        ("published", "submit"),
        ("rejected", "submit"),
        ("pending", "approve"),
        ("pending", "reject"),
    }
    if (current, action) not in allowed:
        raise ValueError(f"invalid_design_transition:{current}:{target}")
    return True


def _copy(package: DesignPackage, action: DesignAction) -> tuple[str, str, str | None]:
    if action == "submit":
        return (
            "DesignSubmitted",
            f"Дизайн v{package.version} на согласовании: {package.title}",
            package.notes,
        )
    if action == "approve":
        return (
            "DesignApproved",
            f"Дизайн согласован: {package.title}",
            f"Версия {package.version}",
        )
    return (
        "DesignRejected",
        f"Дизайн возвращён на доработку: {package.title}",
        package.notes,
    )


def _notification_targets(project: Project, actor_id: str, action: DesignAction) -> list[str]:
    if action == "submit":
        candidates = {project.customer_id}
    else:
        candidates = {project.contractor_id, project.foreman_id}
    return sorted(value for value in candidates if value and value != actor_id)


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    package: DesignPackage,
    actor_id: str,
    action: DesignAction,
    reason: str | None,
) -> None:
    kind, title, default_body = _copy(package, action)
    body = (reason or "").strip() or default_body
    await outbox.enqueue(
        db,
        aggregate_type="design_package",
        aggregate_id=package.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "link_path": "/design",
        },
    )
    notification_title = {
        "submit": "Дизайн на согласовании",
        "approve": "Дизайн согласован",
        "reject": "Дизайн требует доработки",
    }[action]
    for recipient_id in _notification_targets(project, actor_id, action):
        await outbox.enqueue(
            db,
            aggregate_type="design_package",
            aggregate_id=package.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": recipient_id,
                "project_id": project.id,
                "notification_type": "approval",
                "title": notification_title,
                "body": body or f"{package.title} · v{package.version}",
                "link_path": "/design" if action == "submit" else "/(contractor)/(tabs)/object",
                "return_to": "/(customer)/(tabs)/home" if action == "submit" else "/(contractor)/(tabs)/home",
            },
        )


async def transition_package(
    db: AsyncSession,
    *,
    project: Project,
    package_id: str,
    actor: User,
    action: DesignAction,
    reason: str | None = None,
) -> tuple[DesignPackage | None, bool]:
    """Apply one role-scoped transition and commit state with durable evidence."""
    query = select(DesignPackage).where(
        DesignPackage.id == package_id,
        DesignPackage.project_id == project.id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    package = (await db.execute(query)).scalar_one_or_none()
    if package is None:
        return None, False

    _validate_actor(project, actor, action)
    current = str(package.status or "")
    changed = _validate_transition(current, action)
    if not changed:
        return package, True

    package.status = _target(action)
    try:
        await _prepare_effects(
            db,
            project=project,
            package=package,
            actor_id=actor.id,
            action=action,
            reason=reason,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(package)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source=f"design_package.{action}",
        limit=10,
    )
    return package, False
