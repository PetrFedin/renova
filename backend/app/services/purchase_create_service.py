"""Transactional, duplicate-safe purchase creation from approved material picks."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
)


def _uuid() -> str:
    return str(uuid4())


_ACTIVE_PURCHASE_STATUSES = {
    PurchaseStatus.draft,
    PurchaseStatus.approved,
    PurchaseStatus.ordered,
    PurchaseStatus.partial,
    PurchaseStatus.paid,
    PurchaseStatus.delivered,
}


async def prepare_purchase_from_picks(
    db: AsyncSession,
    *,
    project_id: str,
    pick_ids: list[str],
    supplier_name: str | None,
) -> Purchase:
    canonical_ids = sorted(set(pick_ids))
    if not canonical_ids:
        raise ValueError("purchase_picks_required")

    query = select(MaterialPick).where(
        MaterialPick.id.in_(canonical_ids),
        MaterialPick.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    picks = list((await db.execute(query)).scalars().all())
    if len(picks) != len(canonical_ids):
        raise ValueError("purchase_picks_not_found")
    if any(pick.status != MaterialPickStatus.approved for pick in picks):
        raise ValueError("picks_not_approved")

    active_item = (
        await db.execute(
            select(PurchaseItem.id)
            .join(Purchase, Purchase.id == PurchaseItem.purchase_id)
            .where(
                PurchaseItem.material_pick_id.in_(canonical_ids),
                Purchase.project_id == project_id,
                Purchase.status.in_(_ACTIVE_PURCHASE_STATUSES),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if active_item:
        raise ValueError("picks_already_in_active_purchase")

    by_id = {pick.id: pick for pick in picks}
    ordered_picks = [by_id[pick_id] for pick_id in canonical_ids]
    purchase = Purchase(
        id=_uuid(),
        project_id=project_id,
        supplier_name=(supplier_name or ordered_picks[0].shop_name or "").strip() or None,
        status=PurchaseStatus.draft,
    )
    total = 0.0
    items: list[PurchaseItem] = []
    for pick in ordered_picks:
        quantity = float(pick.qty_needed or pick.qty or 0)
        unit_price = float(pick.price or 0)
        if quantity <= 0:
            raise ValueError("purchase_pick_quantity_invalid")
        total += quantity * unit_price
        items.append(
            PurchaseItem(
                id=_uuid(),
                purchase=purchase,
                material_pick_id=pick.id,
                name=pick.name,
                qty=quantity,
                unit=pick.unit,
                unit_price=unit_price,
                room_id=pick.room_id,
                stage_id=pick.stage_id,
            )
        )
    purchase.total_amount = round(total, 2)
    purchase.items = items
    db.add(purchase)
    await db.flush()
    return purchase


async def get_purchase_with_items(
    db: AsyncSession,
    *,
    project_id: str,
    purchase_id: str,
) -> Purchase | None:
    return (
        await db.execute(
            select(Purchase)
            .where(Purchase.id == purchase_id, Purchase.project_id == project_id)
            .options(selectinload(Purchase.items))
            .limit(1)
        )
    ).scalar_one_or_none()
