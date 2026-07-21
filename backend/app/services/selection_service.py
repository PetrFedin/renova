"""P2.2: selections → procurement chain."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import MaterialPick, MaterialPickStatus, SelectionItem


async def material_pick_from_selection(db: AsyncSession, row: SelectionItem) -> MaterialPick:
    """Согласованный подбор → MaterialPick (approved) для закупки."""
    notes = row.notes or ""
    if row.sku:
        notes = f"SKU: {row.sku}\n{notes}".strip()
    pick = MaterialPick(
        project_id=row.project_id,
        room_id=row.room_id,
        name=row.title,
        qty=1,
        unit="шт",
        price=row.price,
        shop_url=row.shop_url,
        shop_name=row.shop_name,
        work_type=row.category,
        category=row.category,
        status=MaterialPickStatus.approved,
        notes=notes or None,
    )
    db.add(pick)
    await db.flush()
    return pick
