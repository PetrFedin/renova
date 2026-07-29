"""Project-scoped, replay-safe MaterialPick lifecycle."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Room,
)
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects

MaterialPickAction = Literal["submit", "approve", "reject"]

_ACTIVE_PURCHASE_STATUSES = {
    PurchaseStatus.draft,
    PurchaseStatus.approved,
    PurchaseStatus.ordered,
    PurchaseStatus.partial,
    PurchaseStatus.paid,
    PurchaseStatus.delivered,
}


@dataclass(frozen=True)
class MaterialPickEvent:
    kind: str
    title: str
    body: str | None
    recipient_id: str | None
    notification_title: str | None
    notification_body: str | None
    notification_link: str | None


async def get_pick(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
    for_update: bool = False,
) -> MaterialPick | None:
    query = select(MaterialPick).where(
        MaterialPick.id == pick_id,
        MaterialPick.project_id == project_id,
    )
    if for_update:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _validate_room(db: AsyncSession, *, project_id: str, room_id: str | None) -> None:
    if not room_id:
        return
    room = (
        await db.execute(
            select(Room.id).where(Room.id == room_id, Room.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not room:
        raise ValueError("material_pick_room_not_found")


async def prepare_pick(
    db: AsyncSession,
    *,
    project_id: str,
    name: str,
    room_id: str | None,
    qty: float,
    unit: str,
    price: float,
    shop_url: str | None,
    shop_name: str | None,
    work_type: str | None,
    analog_of_id: str | None,
    notes: str | None,
) -> MaterialPick:
    await _validate_room(db, project_id=project_id, room_id=room_id)
    if analog_of_id:
        parent = await get_pick(db, project_id=project_id, pick_id=analog_of_id)
        if not parent:
            raise ValueError("material_pick_analog_not_found")
    pick = MaterialPick(
        project_id=project_id,
        name=name.strip(),
        room_id=room_id,
        qty=float(qty),
        unit=unit.strip(),
        price=float(price),
        shop_url=(shop_url or "").strip() or None,
        shop_name=(shop_name or "").strip() or None,
        work_type=(work_type or "").strip() or None,
        analog_of_id=analog_of_id,
        notes=(notes or "").strip() or None,
        status=MaterialPickStatus.draft,
    )
    db.add(pick)
    await db.flush()
    return pick


async def material_pick_has_active_purchase(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
) -> bool:
    linked = (
        await db.execute(
            select(PurchaseItem.id)
            .join(Purchase, Purchase.id == PurchaseItem.purchase_id)
            .where(
                PurchaseItem.material_pick_id == pick_id,
                Purchase.project_id == project_id,
                Purchase.status.in_(_ACTIVE_PURCHASE_STATUSES),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return linked is not None


async def require_editable_pick(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
) -> MaterialPick | None:
    pick = await get_pick(db, project_id=project_id, pick_id=pick_id, for_update=True)
    if not pick:
        return None
    if pick.status != MaterialPickStatus.draft:
        raise ValueError("material_pick_not_editable")
    if await material_pick_has_active_purchase(db, project_id=project_id, pick_id=pick_id):
        raise ValueError("material_pick_locked_by_purchase")
    return pick


def _target_for(action: MaterialPickAction) -> MaterialPickStatus:
    return {
        "submit": MaterialPickStatus.pending,
        "approve": MaterialPickStatus.approved,
        "reject": MaterialPickStatus.draft,
    }[action]


def validate_transition(current: MaterialPickStatus, action: MaterialPickAction) -> bool:
    target = _target_for(action)
    if current == target:
        return False
    if current == MaterialPickStatus.purchased:
        raise ValueError("material_pick_transition_terminal")
    allowed = {
        (MaterialPickStatus.draft, "submit"),
        (MaterialPickStatus.pending, "approve"),
        (MaterialPickStatus.pending, "reject"),
    }
    if (current, action) not in allowed:
        raise ValueError("material_pick_transition_invalid")
    return True


def event_for(
    *,
    action: MaterialPickAction,
    pick: MaterialPick,
    project: Project | None,
    actor_id: str,
    reason: str | None,
) -> MaterialPickEvent:
    reason_text = (reason or "").strip() or None
    if action == "submit":
        recipient = project.customer_id if project and project.customer_id != actor_id else None
        return MaterialPickEvent(
            kind="approval",
            title=f"На согласовании: {pick.name}",
            body=pick.shop_url,
            recipient_id=recipient,
            notification_title="Материал на согласовании",
            notification_body=pick.name,
            notification_link="/approvals",
        )
    if action == "approve":
        recipient = project.contractor_id if project and project.contractor_id != actor_id else None
        return MaterialPickEvent(
            kind="approval",
            title=f"Согласовано: {pick.name}",
            body=None,
            recipient_id=recipient,
            notification_title="Материал согласован",
            notification_body=pick.name,
            notification_link="/(contractor)/(tabs)/repair?tab=materials",
        )
    recipient = project.contractor_id if project and project.contractor_id != actor_id else None
    return MaterialPickEvent(
        kind="approval",
        title=f"На доработку: {pick.name}",
        body=reason_text,
        recipient_id=recipient,
        notification_title="Материал возвращён на доработку",
        notification_body=f"{pick.name}: {reason_text}" if reason_text else pick.name,
        notification_link="/(contractor)/(tabs)/repair?tab=materials",
    )


async def _prepare_effects(
    db: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
    pick: MaterialPick,
    event: MaterialPickEvent,
) -> list[PreparedSideEffect]:
    from app.services import outbox_service as outbox

    activity_row = await outbox.enqueue(
        db,
        aggregate_type="material_pick",
        aggregate_id=pick.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project_id,
            "user_id": actor_id,
            "kind": event.kind,
            "title": event.title,
            "body": event.body,
            "room_id": pick.room_id,
            "work_type": pick.work_type,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    effects = [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]
    if event.recipient_id and event.notification_title:
        notification_row = await outbox.enqueue(
            db,
            aggregate_type="material_pick",
            aggregate_id=pick.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": event.recipient_id,
                "project_id": project_id,
                "notification_type": "approval",
                "title": event.notification_title,
                "body": event.notification_body or pick.name,
                "link_path": event.notification_link,
                "return_to": "/(customer)/(tabs)/home",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=notification_row.id,
                match_key=event.recipient_id,
            )
        )
    return effects


async def transition_pick(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
    action: MaterialPickAction,
    actor_id: str,
    reason: str | None = None,
) -> tuple[MaterialPick | None, bool, MaterialPickEvent | None]:
    pick = await get_pick(db, project_id=project_id, pick_id=pick_id, for_update=True)
    if not pick:
        return None, False, None
    changed = validate_transition(pick.status, action)
    project = await db.get(Project, project_id)
    event = event_for(
        action=action,
        pick=pick,
        project=project,
        actor_id=actor_id,
        reason=reason,
    )
    if not changed:
        await db.commit()
        return pick, False, event
    if await material_pick_has_active_purchase(db, project_id=project_id, pick_id=pick.id):
        raise ValueError("material_pick_locked_by_purchase")
    pick.status = _target_for(action)
    effects = await _prepare_effects(
        db,
        project_id=project_id,
        actor_id=actor_id,
        pick=pick,
        event=event,
    )
    await db.commit()
    await db.refresh(pick)
    activate_client_write_side_effects(effects)
    return pick, True, event
