"""Floor-plan / pin / furniture create with ACL binding and replay safety.

Consolidates the fixes for:
  - #377: PATCH pin and POST furniture must bind referenced rows to the path
    project before any mutation (privacy-preserving 404 on mismatch).
  - #442/#468/#475: floor-plan create, furniture create and pin upsert must
    be replay-safe — a lost response after a server commit must resolve back
    to the original entity via a stable client_request_id instead of minting
    a duplicate, and the mutation + its activity evidence + the
    ClientWriteRequest ledger row commit atomically in one transaction.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import FloorPlan, FloorPlanPin, FurnitureItem, Project, Room
from app.services import outbox_inline_dispatch
from app.services import team_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import clear_request_side_effect_context

FLOOR_PLAN_CREATE_SCOPE = "floor_plan.create"
FURNITURE_CREATE_SCOPE = "furniture.create"
PIN_UPSERT_SCOPE = "floor_plan_pin.upsert"


async def _reload_project(db: AsyncSession, project_id: str, *, lock: bool = False) -> Project:
    """Re-fetch the authoritative Project row, bypassing the identity map.

    Mirrors waste_order_service._reload_project: a caller may have obtained
    `project` via `require_project()` before a row lock below was granted,
    and a concurrent authority change could have landed in the meantime.
    """
    query = select(Project).where(Project.id == project_id).execution_options(populate_existing=True)
    if lock:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    fresh = (await db.execute(query)).scalar_one_or_none()
    if fresh is None or getattr(fresh, "trashed_at", None):
        raise ValueError("floor_plan_project_authority_stale")
    return fresh


async def _require_write_authority(db: AsyncSession, *, project: Project, actor_id: str) -> None:
    from app.models.entities import User

    actor = await db.get(User, actor_id)
    if actor is None or not await team_service.can_access_project(db, actor, project, write=True):
        raise ValueError("floor_plan_project_authority_stale")


def canonical_floor_plan_create_payload(
    *, name: str, floor_level: int, image_key: str, width_px: int | None, height_px: int | None
) -> dict:
    return {
        "name": name,
        "floor_level": floor_level,
        "image_key": image_key,
        "width_px": width_px,
        "height_px": height_px,
    }


async def create_or_replay_floor_plan(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    name: str,
    floor_level: int,
    image_key: str,
    width_px: int | None,
    height_px: int | None,
    client_request_id: str | None,
) -> tuple[FloorPlan, bool]:
    """Create exactly one FloorPlan per client_request_id (#442/#475).

    The FloorPlan row, its `plan` activity DomainOutbox row and the
    ClientWriteRequest ledger entry commit in a single transaction, so a
    response lost after the server commit replays into the original plan
    instead of minting a duplicate.
    """
    payload = canonical_floor_plan_create_payload(
        name=name, floor_level=floor_level, image_key=image_key, width_px=width_px, height_px=height_px,
    )
    try:
        replay_id = await replay_entity_id(
            db,
            scope=FLOOR_PLAN_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            existing = await db.get(FloorPlan, replay_id)
            if not existing or existing.project_id != project.id:
                raise ValueError("floor_plan_idempotency_target_missing")
            return existing, True

        plan = FloorPlan(
            project_id=project.id,
            name=name,
            floor_level=floor_level,
            image_key=image_key,
            width_px=width_px,
            height_px=height_px,
        )
        db.add(plan)
        await db.flush()
        created, canonical_id = await commit_client_write(
            db,
            scope=FLOOR_PLAN_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=plan.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await db.get(FloorPlan, canonical_id)
        if not existing:
            raise ValueError("floor_plan_idempotency_target_missing")
        return existing, True

    await db.refresh(plan)
    await outbox_inline_dispatch.dispatch_best_effort(db, source=FLOOR_PLAN_CREATE_SCOPE, limit=4)
    return plan, False


async def _validate_furniture_refs(db: AsyncSession, *, project_id: str, room_id: str | None, floor_plan_id: str | None) -> None:
    """#377: room_id/floor_plan_id must belong to the path project, or 404."""
    if room_id is not None:
        room = await db.get(Room, room_id)
        if room is None or room.project_id != project_id:
            raise ValueError("furniture_room_not_found")
    if floor_plan_id is not None:
        plan = await db.get(FloorPlan, floor_plan_id)
        if plan is None or plan.project_id != project_id:
            raise ValueError("furniture_floor_plan_not_found")


def canonical_furniture_create_payload(
    *,
    room_id: str | None,
    floor_plan_id: str | None,
    name: str,
    width_m: float,
    depth_m: float,
    height_m: float,
    x_pct: float | None,
    y_pct: float | None,
    notes: str | None,
) -> dict:
    return {
        "room_id": room_id,
        "floor_plan_id": floor_plan_id,
        "name": name,
        "width_m": width_m,
        "depth_m": depth_m,
        "height_m": height_m,
        "x_pct": x_pct,
        "y_pct": y_pct,
        "notes": notes,
    }


async def create_or_replay_furniture(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    room_id: str | None,
    floor_plan_id: str | None,
    name: str,
    width_m: float,
    depth_m: float,
    height_m: float,
    x_pct: float | None,
    y_pct: float | None,
    notes: str | None,
    client_request_id: str | None,
) -> tuple[FurnitureItem, bool]:
    """Create exactly one FurnitureItem per client_request_id (#442/#468).

    room_id/floor_plan_id are validated against the path project before any
    write (#377); the FurnitureItem, its activity DomainOutbox row and the
    ClientWriteRequest ledger entry commit atomically.
    """
    await _validate_furniture_refs(db, project_id=project.id, room_id=room_id, floor_plan_id=floor_plan_id)

    payload = canonical_furniture_create_payload(
        room_id=room_id, floor_plan_id=floor_plan_id, name=name, width_m=width_m,
        depth_m=depth_m, height_m=height_m, x_pct=x_pct, y_pct=y_pct, notes=notes,
    )
    try:
        replay_id = await replay_entity_id(
            db,
            scope=FURNITURE_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            existing = await db.get(FurnitureItem, replay_id)
            if not existing or existing.project_id != project.id:
                raise ValueError("furniture_idempotency_target_missing")
            return existing, True

        item = FurnitureItem(
            project_id=project.id,
            room_id=room_id,
            floor_plan_id=floor_plan_id,
            name=name,
            width_m=width_m,
            depth_m=depth_m,
            height_m=height_m,
            x_pct=x_pct,
            y_pct=y_pct,
            notes=notes,
        )
        db.add(item)
        await db.flush()
        created, canonical_id = await commit_client_write(
            db,
            scope=FURNITURE_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=item.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await db.get(FurnitureItem, canonical_id)
        if not existing:
            raise ValueError("furniture_idempotency_target_missing")
        return existing, True

    await db.refresh(item)
    await outbox_inline_dispatch.dispatch_best_effort(db, source=FURNITURE_CREATE_SCOPE, limit=4)
    return item, False


def canonical_pin_upsert_payload(*, room_id: str, x_pct: float, y_pct: float, label: str | None) -> dict:
    return {"room_id": room_id, "x_pct": x_pct, "y_pct": y_pct, "label": label}


async def upsert_or_replay_pin(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    plan_id: str,
    room_id: str,
    x_pct: float,
    y_pct: float,
    label: str | None,
    client_request_id: str | None,
) -> tuple[FloorPlanPin, bool]:
    """Upsert one pin per (plan, room), with replay-safe evidence (#475).

    The target FloorPlan is row-locked before read/insert so two concurrent
    writers (a second API request, or accept_orchestrator's acceptance pin
    write) for the same plan/room serialize instead of racing to insert
    duplicate pins. Write authority is revalidated against a freshly loaded
    Project after any wait on that lock. A repeated client_request_id with
    the same canonical payload replays the existing pin without re-emitting
    the room_change activity a second time; a changed payload raises
    IdempotencyConflict (409).
    """
    try:
        plan_query = select(FloorPlan).where(FloorPlan.id == plan_id, FloorPlan.project_id == project.id)
        try:
            plan_query = plan_query.with_for_update()
        except Exception:
            pass
        plan = (await db.execute(plan_query)).scalar_one_or_none()
        if plan is None:
            raise ValueError("floor_plan_not_found")

        fresh_project = await _reload_project(db, project.id)
        await _require_write_authority(db, project=fresh_project, actor_id=actor_id)

        room = await db.get(Room, room_id)
        if room is None or room.project_id != fresh_project.id:
            raise ValueError("floor_plan_pin_room_invalid")

        payload = canonical_pin_upsert_payload(room_id=room_id, x_pct=x_pct, y_pct=y_pct, label=label)

        replay_id = await replay_entity_id(
            db,
            scope=PIN_UPSERT_SCOPE,
            project_id=fresh_project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            existing = await db.get(FloorPlanPin, replay_id)
            if not existing or existing.floor_plan_id != plan_id:
                raise ValueError("floor_plan_pin_idempotency_target_missing")
            return existing, True

        existing_pin = (
            await db.execute(
                select(FloorPlanPin).where(
                    FloorPlanPin.floor_plan_id == plan_id,
                    FloorPlanPin.room_id == room_id,
                )
            )
        ).scalar_one_or_none()
        if existing_pin:
            existing_pin.x_pct, existing_pin.y_pct, existing_pin.label = x_pct, y_pct, label
            pin = existing_pin
        else:
            pin = FloorPlanPin(floor_plan_id=plan_id, room_id=room_id, x_pct=x_pct, y_pct=y_pct, label=label)
            db.add(pin)
        await db.flush()

        created, canonical_id = await commit_client_write(
            db,
            scope=PIN_UPSERT_SCOPE,
            project_id=fresh_project.id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=pin.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await db.get(FloorPlanPin, canonical_id)
        if not existing:
            raise ValueError("floor_plan_pin_idempotency_target_missing")
        return existing, True

    await db.refresh(pin)
    await outbox_inline_dispatch.dispatch_best_effort(db, source=PIN_UPSERT_SCOPE, limit=4)
    return pin, False
