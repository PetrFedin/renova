"""Replay-safe SelectionItem creation for #415 / parent #316."""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import SelectionItem, SelectionStatus
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "selection.create"


def canonical_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Mirror the persisted create semantics without using payload equality as identity."""
    return {
        "room_id": payload.get("room_id"),
        "category": payload.get("category", "other"),
        "title": str(payload.get("title") or "").strip(),
        "sku": payload.get("sku"),
        "allowance": payload.get("allowance"),
        "price": payload.get("price", 0),
        "shop_url": payload.get("shop_url"),
        "shop_name": payload.get("shop_name"),
        "notes": payload.get("notes"),
    }


async def _replay(db: AsyncSession, *, project_id: str, selection_id: str) -> SelectionItem:
    row = await db.get(SelectionItem, selection_id)
    if row is None or row.project_id != project_id:
        raise RuntimeError("selection_replay_corrupt")
    return row


async def create_selection(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[SelectionItem, bool]:
    canonical = canonical_payload(payload)

    replay_id = await replay_entity_id(
        db,
        scope=SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=canonical,
    )
    if replay_id:
        return await _replay(db, project_id=project_id, selection_id=replay_id), True

    row = SelectionItem(
        project_id=project_id,
        room_id=canonical["room_id"],
        category=canonical["category"],
        title=canonical["title"],
        sku=canonical["sku"],
        allowance=canonical["allowance"],
        price=canonical["price"],
        shop_url=canonical["shop_url"],
        shop_name=canonical["shop_name"],
        notes=canonical["notes"],
        proposed_by_id=user_id,
        status=SelectionStatus.draft,
    )
    db.add(row)
    await db.flush()

    await outbox.enqueue(
        db,
        aggregate_type="selection",
        aggregate_id=row.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project_id,
            "user_id": user_id,
            "kind": "selection",
            "title": f"Подбор: {row.title}",
            "body": row.category,
            "room_id": row.room_id,
            "link_path": "/(customer)/(tabs)/repair?tab=selections",
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
            entity_id=row.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        return await _replay(db, project_id=project_id, selection_id=entity_id), True

    await db.refresh(row)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="selection.create", limit=10)
    return row, False
