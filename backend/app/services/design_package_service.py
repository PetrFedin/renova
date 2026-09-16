"""Canonical design-package lifecycle with durable decision evidence."""
from __future__ import annotations

from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import DesignPackage, Project, User
from app.services import outbox_service as outbox
from app.services import team_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

DesignAction = Literal["submit", "approve", "reject"]
DESIGN_PACKAGE_CREATE_SCOPE = "design_package.create"


def _target(action: DesignAction) -> str:
    return {
        "submit": "pending",
        "approve": "approved",
        "reject": "rejected",
    }[action]


async def _is_executor(db: AsyncSession, project: Project, actor: User) -> bool:
    role = await team_service.team_role_for_project(db, actor, project)
    return role in {"owner", "foreman"}


async def _validate_actor(db: AsyncSession, project: Project, actor: User, action: DesignAction) -> None:
    if action == "submit":
        if not await _is_executor(db, project, actor):
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
        candidates = {project.contractor_id}
    return sorted(value for value in candidates if value and value != actor_id)


def _normalize_create_payload(
    *,
    title: str,
    file_key: str | None,
    notes: str | None,
) -> dict[str, str | None]:
    normalized_title = (title or "").strip()
    if not normalized_title or len(normalized_title) > 255:
        raise ValueError("design_title_invalid")
    normalized_file_key = (file_key or "").strip() or None
    if normalized_file_key and len(normalized_file_key) > 512:
        raise ValueError("design_file_key_invalid")
    normalized_notes = (notes or "").strip() or None
    if normalized_notes and len(normalized_notes) > 4000:
        raise ValueError("design_notes_invalid")
    return {
        "title": normalized_title,
        "file_key": normalized_file_key,
        "notes": normalized_notes,
    }


async def _replay_package(
    db: AsyncSession,
    *,
    project_id: str,
    package_id: str,
) -> DesignPackage:
    package = await db.get(DesignPackage, package_id)
    if package is None or package.project_id != project_id:
        raise RuntimeError("design_package_replay_corrupt")
    return package


async def create_package(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    client_request_id: str,
    title: str,
    file_key: str | None = None,
    notes: str | None = None,
) -> tuple[DesignPackage, bool]:
    """Create one design version per explicit client intent.

    The project row is refreshed and locked before executor authority/version
    allocation. Package, activity outbox and ClientWriteRequest share the same
    commit boundary. Replays return the original package and never allocate a
    second version merely because the first response was lost.
    """
    payload = _normalize_create_payload(title=title, file_key=file_key, notes=notes)

    replay_id = await replay_entity_id(
        db,
        scope=DESIGN_PACKAGE_CREATE_SCOPE,
        project_id=project.id,
        user_id=actor.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        return await _replay_package(db, project_id=project.id, package_id=replay_id), True

    locked = (
        await db.execute(
            select(Project)
            .where(Project.id == project.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if locked is None:
        raise ValueError("design_project_not_found")
    if not await _is_executor(db, locked, actor):
        raise ValueError("design_decision_actor_forbidden")

    # A second request may have waited on the project lock while the first
    # committed. READ COMMITTED makes this recheck observe the canonical row.
    replay_id = await replay_entity_id(
        db,
        scope=DESIGN_PACKAGE_CREATE_SCOPE,
        project_id=locked.id,
        user_id=actor.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        return await _replay_package(db, project_id=locked.id, package_id=replay_id), True

    version = int(
        await db.scalar(
            select(func.max(DesignPackage.version)).where(
                DesignPackage.project_id == locked.id
            )
        )
        or 0
    ) + 1
    package = DesignPackage(
        project_id=locked.id,
        title=str(payload["title"]),
        version=version,
        file_key=payload["file_key"],
        notes=payload["notes"],
        status="published",
    )
    db.add(package)
    await db.flush()
    await outbox.enqueue(
        db,
        aggregate_type="design_package",
        aggregate_id=package.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": locked.id,
            "user_id": actor.id,
            "kind": "DesignCreated",
            "title": f"Дизайн v{version}: {package.title}",
            "body": package.notes,
            "link_path": "/design",
        },
    )

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=DESIGN_PACKAGE_CREATE_SCOPE,
            project_id=locked.id,
            user_id=actor.id,
            request_id=client_request_id,
            payload=payload,
            entity_id=package.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        return await _replay_package(db, project_id=locked.id, package_id=entity_id), True

    await db.refresh(package)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="design_package.create", limit=10)
    return package, False


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

    await _validate_actor(db, project, actor, action)
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
