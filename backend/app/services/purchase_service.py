"""Закупки Renova OS: потребность → заказ → доставка → разблокировка работ."""
from app.core.timeutil import utc_now
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Stage,
    StageStatus,
)
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects


def _uuid() -> str:
    return str(uuid4())


_PURCHASE_STATUS_RANK = {
    PurchaseStatus.draft: 0,
    PurchaseStatus.approved: 1,
    PurchaseStatus.ordered: 2,
    PurchaseStatus.partial: 3,
    PurchaseStatus.paid: 4,
    PurchaseStatus.delivered: 5,
}
_TERMINAL_PURCHASE_STATUSES = {PurchaseStatus.cancelled, PurchaseStatus.returned}


def validate_purchase_transition(current: PurchaseStatus, target: PurchaseStatus) -> None:
    if current == target:
        return
    if current in _TERMINAL_PURCHASE_STATUSES:
        raise ValueError("purchase_transition_terminal")
    if target in _TERMINAL_PURCHASE_STATUSES:
        if target == PurchaseStatus.returned and current != PurchaseStatus.delivered:
            raise ValueError("purchase_return_requires_delivery")
        return
    current_rank = _PURCHASE_STATUS_RANK.get(current)
    target_rank = _PURCHASE_STATUS_RANK.get(target)
    if current_rank is None or target_rank is None or target_rank <= current_rank:
        raise ValueError("purchase_transition_invalid")


def purchase_status_event(
    status: PurchaseStatus,
    items_count: int,
    stage_count: int,
) -> tuple[str, str, str | None]:
    if status == PurchaseStatus.delivered:
        return (
            "MaterialDelivered",
            f"Материалы доставлены: {items_count} поз.",
            f"Проверены связанные этапы: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.cancelled:
        return (
            "PurchaseCancelled",
            f"Закупка отменена: {items_count} поз.",
            f"Зависимости этапов пересчитаны: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.returned:
        return (
            "PurchaseReturned",
            f"Материалы возвращены: {items_count} поз.",
            f"Зависимости этапов пересчитаны: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.ordered:
        return ("MaterialOrdered", f"Материалы заказаны: {items_count} поз.", None)
    if status == PurchaseStatus.paid:
        return ("PurchasePaid", f"Закупка оплачена: {items_count} поз.", None)
    if status == PurchaseStatus.partial:
        return ("PurchasePartiallyPaid", f"Закупка частично оплачена: {items_count} поз.", None)
    if status == PurchaseStatus.approved:
        return ("PurchaseApproved", f"Закупка согласована: {items_count} поз.", None)
    return ("PurchaseUpdated", f"Закупка → {status.value}", None)


def purchase_dict(purchase: Purchase) -> dict:
    return {
        "id": purchase.id,
        "project_id": purchase.project_id,
        "supplier_id": purchase.supplier_id,
        "supplier_name": purchase.supplier_name,
        "status": purchase.status.value,
        "total_amount": round(purchase.total_amount or 0, 2),
        "ordered_at": purchase.ordered_at.isoformat() if purchase.ordered_at else None,
        "paid_at": purchase.paid_at.isoformat() if purchase.paid_at else None,
        "delivered_at": purchase.delivered_at.isoformat() if purchase.delivered_at else None,
        "receipt_id": purchase.receipt_id,
        "notes": purchase.notes,
        "items": [
            {
                "id": item.id,
                "material_pick_id": item.material_pick_id,
                "name": item.name,
                "qty": item.qty,
                "unit": item.unit,
                "unit_price": item.unit_price,
                "room_id": item.room_id,
                "stage_id": item.stage_id,
                "total": round(item.qty * item.unit_price, 2),
            }
            for item in (purchase.items or [])
        ],
        "created_at": purchase.created_at.isoformat() if purchase.created_at else None,
    }


async def list_purchases(db: AsyncSession, project_id: str) -> list[Purchase]:
    result = await db.execute(
        select(Purchase)
        .where(Purchase.project_id == project_id)
        .options(selectinload(Purchase.items))
        .order_by(Purchase.created_at.desc())
    )
    return list(result.scalars().all())


async def create_from_picks(
    db: AsyncSession,
    project_id: str,
    pick_ids: list[str],
    supplier_name: str | None = None,
) -> Purchase | None:
    if not pick_ids:
        return None
    result = await db.execute(
        select(MaterialPick).where(
            MaterialPick.id.in_(pick_ids),
            MaterialPick.project_id == project_id,
        )
    )
    picks = list(result.scalars().all())
    if not picks:
        return None
    not_approved = [pick for pick in picks if pick.status != MaterialPickStatus.approved]
    if not_approved:
        raise ValueError("picks_not_approved")
    purchase = Purchase(
        id=_uuid(),
        project_id=project_id,
        supplier_name=supplier_name or picks[0].shop_name,
        status=PurchaseStatus.draft,
    )
    total = 0.0
    items: list[PurchaseItem] = []
    for pick in picks:
        quantity = pick.qty_needed or pick.qty
        total += quantity * pick.price
        items.append(
            PurchaseItem(
                id=_uuid(),
                purchase=purchase,
                material_pick_id=pick.id,
                name=pick.name,
                qty=quantity,
                unit=pick.unit,
                unit_price=pick.price,
                room_id=pick.room_id,
                stage_id=pick.stage_id,
            )
        )
    purchase.total_amount = round(total, 2)
    purchase.items = items
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase, ["items"])
    return purchase


def _project_member_ids(project: Project) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for user_id in [project.customer_id, project.contractor_id, project.foreman_id]:
        if user_id and user_id not in seen:
            seen.add(user_id)
            result.append(user_id)
    return result


async def _prepare_status_side_effects(
    db: AsyncSession,
    *,
    project: Project,
    purchase: Purchase,
    actor_id: str,
    status: PurchaseStatus,
) -> list[PreparedSideEffect]:
    from app.services import outbox_service as outbox

    items_count = len(purchase.items or [])
    stage_count = len({item.stage_id for item in (purchase.items or []) if item.stage_id})
    kind, title, body = purchase_status_event(status, items_count, stage_count)
    activity_row = await outbox.enqueue(
        db,
        aggregate_type="purchase",
        aggregate_id=purchase.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body or purchase.supplier_name,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    effects = [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]

    if status not in {PurchaseStatus.delivered, PurchaseStatus.cancelled, PurchaseStatus.returned}:
        return effects
    for user_id in _project_member_ids(project):
        if user_id == actor_id:
            continue
        notification_row = await outbox.enqueue(
            db,
            aggregate_type="purchase",
            aggregate_id=purchase.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": user_id,
                "project_id": project.id,
                "notification_type": "materials",
                "title": title,
                "body": body or "Откройте материалы и проверьте влияние на ближайшие этапы.",
                "link_path": "/(customer)/(tabs)/repair?tab=materials",
                "return_to": "/(customer)/(tabs)/home",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=notification_row.id,
                match_key=user_id,
            )
        )
    return effects


async def transition_status(
    db: AsyncSession,
    *,
    project_id: str,
    purchase_id: str,
    status: PurchaseStatus,
    actor_id: str,
) -> tuple[Purchase | None, bool]:
    """Project-scoped, row-locked and replay-safe purchase transition."""
    query = (
        select(Purchase)
        .where(Purchase.id == purchase_id, Purchase.project_id == project_id)
        .options(selectinload(Purchase.items))
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    purchase = (await db.execute(query)).scalar_one_or_none()
    if not purchase:
        return None, False

    current = purchase.status
    validate_purchase_transition(current, status)
    if current == status:
        await db.commit()
        return purchase, False

    now = utc_now()
    purchase.status = status
    if status == PurchaseStatus.ordered and not purchase.ordered_at:
        purchase.ordered_at = now
    elif status == PurchaseStatus.paid and not purchase.paid_at:
        purchase.paid_at = now
    elif status == PurchaseStatus.delivered and not purchase.delivered_at:
        purchase.delivered_at = now
        await _on_delivered(db, purchase)
    elif status in {PurchaseStatus.cancelled, PurchaseStatus.returned}:
        await _on_reversed(db, purchase, was_delivered=current == PurchaseStatus.delivered)

    if status in {
        PurchaseStatus.paid,
        PurchaseStatus.delivered,
        PurchaseStatus.cancelled,
        PurchaseStatus.returned,
    }:
        from app.services import budget_service as budget

        await budget.refresh_budget_facts(db, purchase.project_id)

    project = await db.get(Project, project_id)
    effects = (
        await _prepare_status_side_effects(
            db,
            project=project,
            purchase=purchase,
            actor_id=actor_id,
            status=status,
        )
        if project
        else []
    )
    await db.commit()
    await db.refresh(purchase, ["items"])
    activate_client_write_side_effects(effects)
    return purchase, True


async def set_status(db: AsyncSession, purchase_id: str, status: PurchaseStatus) -> Purchase | None:
    """Compatibility wrapper; API callers should use project-scoped transition_status."""
    purchase = await db.get(Purchase, purchase_id)
    if not purchase:
        return None
    result, _ = await transition_status(
        db,
        project_id=purchase.project_id,
        purchase_id=purchase.id,
        status=status,
        actor_id="",
    )
    from app.services.client_write_side_effects import clear_request_side_effect_context

    clear_request_side_effect_context()
    return result


async def _on_reversed(
    db: AsyncSession,
    purchase: Purchase,
    *,
    was_delivered: bool,
) -> None:
    """Cancel/return restores material availability and stage dependencies once."""
    from app.services import dependency_service as dependencies

    touched_stage_ids: set[str] = set()
    for item in purchase.items or []:
        pick: MaterialPick | None = None
        if item.material_pick_id:
            pick = await db.get(MaterialPick, item.material_pick_id)
            if pick:
                pick.status = MaterialPickStatus.approved
                if was_delivered:
                    pick.qty_delivered = max(0.0, (pick.qty_delivered or 0) - (item.qty or 0))
                if pick.stage_id:
                    touched_stage_ids.add(pick.stage_id)
        if item.stage_id:
            touched_stage_ids.add(item.stage_id)

    for stage_id in touched_stage_ids:
        stage = await db.get(Stage, stage_id)
        if not stage or stage.status == StageStatus.done:
            continue
        evaluation = await dependencies.evaluate_stage(db, stage, commit=False)
        if evaluation["blocked"]:
            stage.status = StageStatus.planned


async def _on_delivered(db: AsyncSession, purchase: Purchase) -> None:
    """Delivery updates picks exactly once and opens eligible dependent work."""
    from app.services import dependency_service as dependencies

    for item in purchase.items or []:
        pick: MaterialPick | None = None
        if item.material_pick_id:
            pick = await db.get(MaterialPick, item.material_pick_id)
            if pick:
                pick.status = MaterialPickStatus.purchased
                pick.qty_delivered = (pick.qty_delivered or 0) + item.qty
                await dependencies.on_material_delivered(
                    db,
                    item.material_pick_id,
                    commit=False,
                )

        stage_id = item.stage_id or (pick.stage_id if pick else None)
        if stage_id:
            stage = await db.get(Stage, stage_id)
            if stage and stage.status == StageStatus.planned:
                evaluation = await dependencies.evaluate_stage(db, stage, commit=False)
                if not evaluation["blocked"]:
                    stage.status = StageStatus.active


async def generate_needs_from_estimate(db: AsyncSession, project_id: str) -> list[MaterialPick]:
    """Сформировать потребности в материалах из строк сметы."""
    result = await db.execute(
        select(EstimateLine).where(
            EstimateLine.project_id == project_id,
            EstimateLine.line_type == LineType.material,
        )
    )
    lines = list(result.scalars().all())
    created: list[MaterialPick] = []
    for line in lines:
        existing = await db.execute(
            select(MaterialPick).where(
                MaterialPick.project_id == project_id,
                MaterialPick.name == line.name,
                MaterialPick.room_id == line.room_id,
            )
        )
        if existing.scalar_one_or_none():
            continue
        pick = MaterialPick(
            project_id=project_id,
            room_id=line.room_id,
            name=line.name,
            qty=line.quantity_planned,
            qty_needed=line.quantity_planned,
            unit=line.unit,
            price=line.unit_price,
            category=line.category or "materials",
            work_type=line.category,
            status=MaterialPickStatus.draft,
            notes="Из сметы",
        )
        db.add(pick)
        created.append(pick)
    if created:
        await db.commit()
        for pick in created:
            await db.refresh(pick)
    return created
