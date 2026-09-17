"""Replay-safe FurnitureItem creation for #468 / parent #316."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import FloorPlan, FurnitureItem, Project, Room, User
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "furniture.create"


def canonical_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Canonical persisted furniture payload; request identity is separate."""
    return {
        "room_id": payload.get("room_id"),
        "floor_plan_id": payload.get("floor_plan_id"),
        "name": str(payload.get("name") or ""),
        "width_m": float(payload.get("width_m", 0.6)),
        "depth_m": float(payload.get("depth_m", 0.6)),
        "height_m": float(payload.get("height_m", 0.8)),
        "x_pct": payload.get("x_pct"),
        "y_pct": payload.get("y_pct"),
        "notes": payload.get("notes"),
    }


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "project_not_found")
    return project


async def _revalidate_authority(
    db: AsyncSession,
    *,
    user_id: str,
    project: Project,
) -> User:
    """Re-check the same project-write authority after any row-lock wait."""
    from app.services import team_service as team_svc

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if not await team_svc.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")
    return actor


async def _validate_refs(
    db: AsyncSession,
    *,
    project_id: str,
    payload: dict[str, Any],
) -> None:
    room_id = payload.get("room_id")
    if room_id is not None:
        room = (
            await db.execute(
                select(Room.id).where(Room.id == room_id, Room.project_id == project_id)
            )
        ).scalar_one_or_none()
        if room is None:
            raise HTTPException(404)

    floor_plan_id = payload.get("floor_plan_id")
    if floor_plan_id is not None:
        plan = (
            await db.execute(
                select(FloorPlan.id).where(
                    FloorPlan.id == floor_plan_id,
                    FloorPlan.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if plan is None:
            raise HTTPException(404)


async def _replay(
    db: AsyncSession,
    *,
    project_id: str,
    furniture_id: str,
) -> FurnitureItem:
    row = await db.get(FurnitureItem, furniture_id)
    if row is None or row.project_id != project_id:
        raise RuntimeError("furniture_replay_corrupt")
    return row


async def create_furniture(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[FurnitureItem, bool]:
    """Create one furniture item exactly once for one logical client intent."""
    canonical = canonical_payload(payload)
    item: FurnitureItem | None = None
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
            replayed = await _replay(db, project_id=project_id, furniture_id=replay_id)
            await db.commit()
            return replayed, True

        await _validate_refs(db, project_id=project_id, payload=canonical)

        item = FurnitureItem(project_id=project_id, **canonical)
        db.add(item)
        await db.flush()

        await outbox.enqueue(
            db,
            aggregate_type="furniture",
            aggregate_id=item.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "plan",
                "title": f"Мебель: {item.name}",
                "body": None,
                "room_id": item.room_id,
                "link_path": None,
            },
        )

        created, entity_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=item.id,
        )
        if not created:
            replayed = await _replay(db, project_id=project_id, furniture_id=entity_id)
            await db.commit()
            return replayed, True
    except BaseException:
        await db.rollback()
        raise

    if item is None:
        raise RuntimeError("furniture_create_missing")
    await db.refresh(item)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="furniture.create", limit=10)
    return item, False
