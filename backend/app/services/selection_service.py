"""P2.2: selections → procurement chain."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import MaterialPick, MaterialPickStatus, Project, SelectionItem


async def material_pick_from_selection(
    db: AsyncSession,
    row: SelectionItem,
    *,
    qty: float | None = None,
    unit: str | None = None,
) -> MaterialPick:
    """Согласованный подбор → MaterialPick (approved) для закупки.

    EST-013: у SelectionItem нет количества (нужна миграция), поэтому заказчик
    может задать его при согласовании; без него — прежние 1 шт.
    """
    notes = row.notes or ""
    if row.sku:
        notes = f"SKU: {row.sku}\n{notes}".strip()
    # REP-28: без исполнителя в проекте закупку может оформить только заказчик —
    # дефолт «покупает исполнитель» оставил бы согласованную позицию без покупателя.
    project = await db.get(Project, row.project_id)
    extra = {"supply_source": "customer_to_buy"} if project is not None and project.contractor_id is None else {}
    pick = MaterialPick(
        project_id=row.project_id,
        room_id=row.room_id,
        name=row.title,
        qty=float(qty) if qty and qty > 0 else 1,
        unit=(unit or "").strip()[:16] or "шт",
        price=row.price,
        price_source="selection_approved" if float(row.price or 0) > 0 else "unset",
        shop_url=row.shop_url,
        shop_name=row.shop_name,
        work_type=row.category,
        category=row.category,
        status=MaterialPickStatus.approved,
        notes=notes or None,
        **extra,
    )
    db.add(pick)
    await db.flush()
    return pick
