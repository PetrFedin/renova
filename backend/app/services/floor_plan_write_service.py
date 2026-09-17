"""Replay-safe FloorPlan creation and FloorPlanPin upsert for #475 / parent #316."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import FloorPlan, FloorPlanPin, Project, Room, User
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

PLAN_SCOPE = "floor_plan.create"
PIN_SCOPE = "floor_plan_pin.upsert"


def canonical_plan_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(payload.get("name") or "Планировка"),
        "floor_level": int(payload.get("floor_level", 1)),
        "image_key": str(payload.get("image_key") or ""),
        "width_px": payload.get("width_px"),
        "height_px": payload.get("height_px"),
    }


def canonical_pin_payload(*, plan_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "plan_id": plan_id,
        "room_id": str(payload.get("room_id") or ""),
        "x_pct": float(payload.get("x_pct", 50)),
        "y_pct": float(payload.get("y_pct", 50)),
        "label": payload.get("label"),
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
    project: Project,
    user_id: str,
) -> User:
    from app.services import team_service

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if getattr(project, "trashed_at", None):
        raise HTTPException(404, "project_in_trash")
    if not await team_service.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")
    return actor


async def lock_floor_plan(
    db: AsyncSession,
    *,
    project_id: str,
    plan_id: str,
) -> FloorPlan:
    """Shared serialization boundary for every canonical FloorPlanPin writer."""
    plan = (
        await db.execute(
            select(FloorPlan)
            .where(FloorPlan.id == plan_id, FloorPlan.project_id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(404, "floor_plan_not_found")
    return plan


async def _project_room_or_404(
    db: AsyncSession,
    *,
    project_id: str,
    room_id: str,
) -> Room:
    room = (
        await db.execute(
            select(Room).where(Room.id == room_id, Room.project_id == project_id)
        )
    ).scalar_one_or_none()
    if room is None:
        raise HTTPException(404, "room_not_found")
    return room


async def _replay_plan(
    db: AsyncSession,
    *,
    project_id: str,
    plan_id: str,
) -> FloorPlan:
    plan = await db.get(FloorPlan, plan_id)
    if plan is None or plan.project_id != project_id:
        raise RuntimeError("floor_plan_replay_corrupt")
    return plan


async def _replay_pin(
    db: AsyncSession,
    *,
    project_id: str,
    plan_id: str,
    pin_id: str,
) -> FloorPlanPin:
    pin = await db.get(FloorPlanPin, pin_id)
    if pin is None or pin.floor_plan_id != plan_id:
        raise RuntimeError("floor_plan_pin_replay_corrupt")
    plan = await db.get(FloorPlan, pin.floor_plan_id)
    if plan is None or plan.project_id != project_id:
        raise RuntimeError("floor_plan_pin_replay_corrupt")
    return pin


async def create_plan(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[FloorPlan, bool]:
    """Create one floor plan and its durable activity exactly once."""
    canonical = canonical_plan_payload(payload)
    plan: FloorPlan | None = None
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_authority(db, project=project, user_id=user_id)

        replay_id = await replay_entity_id(
            db,
            scope=PLAN_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
        )
        if replay_id:
            replayed = await _replay_plan(db, project_id=project_id, plan_id=replay_id)
            await db.commit()
            return replayed, True

        plan = FloorPlan(project_id=project_id, **canonical)
        db.add(plan)
        await db.flush()

        await outbox.enqueue(
            db,
            aggregate_type="floor_plan",
            aggregate_id=plan.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "plan",
                "title": f"Планировка: {plan.name}",
                "body": None,
                "room_id": None,
                "link_path": "/approvals",
            },
        )

        created, entity_id = await commit_client_write(
            db,
            scope=PLAN_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=plan.id,
        )
        if not created:
            replayed = await _replay_plan(db, project_id=project_id, plan_id=entity_id)
            await db.commit()
            return replayed, True
    except BaseException:
        await db.rollback()
        raise

    if plan is None:
        raise RuntimeError("floor_plan_create_missing")
    await db.refresh(plan)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="floor_plan.create", limit=10)
    return plan, False


async def upsert_pin(
    db: AsyncSession,
    *,
    project_id: str,
    plan_id: str,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[FloorPlanPin, bool]:
    """Upsert one room pin and its activity exactly once per logical client intent."""
    canonical = canonical_pin_payload(plan_id=plan_id, payload=payload)
    pin: FloorPlanPin | None = None
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_authority(db, project=project, user_id=user_id)
        plan = await lock_floor_plan(db, project_id=project_id, plan_id=plan_id)
        room = await _project_room_or_404(
            db,
            project_id=project_id,
            room_id=canonical["room_id"],
        )

        replay_id = await replay_entity_id(
            db,
            scope=PIN_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
        )
        if replay_id:
            replayed = await _replay_pin(
                db,
                project_id=project_id,
                plan_id=plan.id,
                pin_id=replay_id,
            )
            await db.commit()
            return replayed, True

        pin = (
            await db.execute(
                select(FloorPlanPin).where(
                    FloorPlanPin.floor_plan_id == plan.id,
                    FloorPlanPin.room_id == room.id,
                )
            )
        ).scalar_one_or_none()
        if pin is None:
            pin = FloorPlanPin(
                floor_plan_id=plan.id,
                room_id=room.id,
                x_pct=canonical["x_pct"],
                y_pct=canonical["y_pct"],
                label=canonical["label"],
            )
            db.add(pin)
        else:
            pin.x_pct = canonical["x_pct"]
            pin.y_pct = canonical["y_pct"]
            pin.label = canonical["label"]
        await db.flush()

        await outbox.enqueue(
            db,
            aggregate_type="floor_plan_pin",
            aggregate_id=pin.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "room_change",
                "title": "Метка комнаты на плане",
                "body": None,
                "room_id": room.id,
                "link_path": f"/room/{room.id}",
            },
        )

        created, entity_id = await commit_client_write(
            db,
            scope=PIN_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=pin.id,
        )
        if not created:
            replayed = await _replay_pin(
                db,
                project_id=project_id,
                plan_id=plan.id,
                pin_id=entity_id,
            )
            await db.commit()
            return replayed, True
    except BaseException:
        await db.rollback()
        raise

    if pin is None:
        raise RuntimeError("floor_plan_pin_upsert_missing")
    await db.refresh(pin)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="floor_plan_pin.upsert", limit=10)
    return pin, False
