"""Закупки Renova OS: потребность → заказ → доставка → разблокировка работ."""
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Stage,
    StageStatus,
)


def _uuid() -> str:
    return str(uuid4())


def purchase_dict(p: Purchase) -> dict:
    return {
        "id": p.id,
        "project_id": p.project_id,
        "supplier_id": p.supplier_id,
        "supplier_name": p.supplier_name,
        "status": p.status.value,
        "total_amount": round(p.total_amount or 0, 2),
        "ordered_at": p.ordered_at.isoformat() if p.ordered_at else None,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        "delivered_at": p.delivered_at.isoformat() if p.delivered_at else None,
        "receipt_id": p.receipt_id,
        "notes": p.notes,
        "items": [
            {
                "id": i.id,
                "material_pick_id": i.material_pick_id,
                "name": i.name,
                "qty": i.qty,
                "unit": i.unit,
                "unit_price": i.unit_price,
                "room_id": i.room_id,
                "stage_id": i.stage_id,
                "total": round(i.qty * i.unit_price, 2),
            }
            for i in (p.items or [])
        ],
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


async def list_purchases(db: AsyncSession, project_id: str) -> list[Purchase]:
    r = await db.execute(
        select(Purchase)
        .where(Purchase.project_id == project_id)
        .options(selectinload(Purchase.items))
        .order_by(Purchase.created_at.desc())
    )
    return list(r.scalars().all())


async def create_from_picks(
    db: AsyncSession,
    project_id: str,
    pick_ids: list[str],
    supplier_name: str | None = None,
) -> Purchase | None:
    if not pick_ids:
        return None
    r = await db.execute(
        select(MaterialPick).where(MaterialPick.id.in_(pick_ids), MaterialPick.project_id == project_id)
    )
    picks = list(r.scalars().all())
    if not picks:
        return None
    purchase = Purchase(
        id=_uuid(),
        project_id=project_id,
        supplier_name=supplier_name or picks[0].shop_name,
        status=PurchaseStatus.draft,
    )
    total = 0.0
    items: list[PurchaseItem] = []
    for pick in picks:
        qty = pick.qty_needed or pick.qty
        line_total = qty * pick.price
        total += line_total
        items.append(
            PurchaseItem(
                id=_uuid(),
                purchase=purchase,
                material_pick_id=pick.id,
                name=pick.name,
                qty=qty,
                unit=pick.unit,
                unit_price=pick.price,
                room_id=pick.room_id,
                stage_id=pick.stage_id,
            )
        )
        pick.status = MaterialPickStatus.approved
    purchase.total_amount = round(total, 2)
    purchase.items = items
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase, ["items"])
    return purchase


async def set_status(db: AsyncSession, purchase_id: str, status: PurchaseStatus) -> Purchase | None:
    p = await db.get(Purchase, purchase_id, options=[selectinload(Purchase.items)])
    if not p:
        return None
    now = datetime.utcnow()
    p.status = status
    if status == PurchaseStatus.ordered:
        p.ordered_at = now
    elif status == PurchaseStatus.paid:
        p.paid_at = now
    elif status == PurchaseStatus.delivered:
        p.delivered_at = now
        await _on_delivered(db, p)
    elif status == PurchaseStatus.cancelled:
        await _on_cancelled(db, p)
    await db.commit()
    await db.refresh(p, ["items"])
    return p



async def _on_cancelled(db: AsyncSession, purchase: Purchase) -> None:
    """Отмена доставки — вернуть pick из факта бюджета и пересчитать budget_spent."""
    from app.services import budget_service as bud

    for item in purchase.items or []:
        if not item.material_pick_id:
            continue
        pick = await db.get(MaterialPick, item.material_pick_id)
        if not pick:
            continue
        pick.status = MaterialPickStatus.approved
        pick.qty_delivered = max(0.0, (pick.qty_delivered or 0) - (item.qty or 0))
    await bud.refresh_budget_facts(db, purchase.project_id)

async def _on_delivered(db: AsyncSession, purchase: Purchase) -> None:
    from app.services import dependency_service as dep_svc
    """Доставка материала → обновить pick и открыть зависимую работу."""
    for item in purchase.items or []:
        if not item.material_pick_id:
            continue
        pick = await db.get(MaterialPick, item.material_pick_id)
        if not pick:
            continue
        pick.status = MaterialPickStatus.purchased
        pick.qty_delivered = (pick.qty_delivered or 0) + item.qty
        if item.material_pick_id:
            await dep_svc.on_material_delivered(db, item.material_pick_id)
        elif item.stage_id:
            stage = await db.get(Stage, item.stage_id)
            if stage and stage.status == StageStatus.planned:
                stage.status = StageStatus.active


async def generate_needs_from_estimate(db: AsyncSession, project_id: str) -> list[MaterialPick]:
    """Сформировать потребности в материалах из строк сметы."""
    r = await db.execute(
        select(EstimateLine).where(
            EstimateLine.project_id == project_id,
            EstimateLine.line_type == LineType.material,
        )
    )
    lines = list(r.scalars().all())
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
        for p in created:
            await db.refresh(p)
    return created
