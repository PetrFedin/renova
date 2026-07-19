"""Change orders — доп. работы с согласованием заказчиком."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import ChangeOrder, ChangeOrderStatus
from app.services.budget_service import apply_change_order_to_budget


async def create_order(db: AsyncSession, project_id: str, user_id: str, title: str, amount: float, description: str | None) -> ChangeOrder:
    co = ChangeOrder(project_id=project_id, title=title, amount=amount, description=description, created_by=user_id)
    db.add(co)
    await db.commit()
    await db.refresh(co)
    return co


async def list_orders(db: AsyncSession, project_id: str) -> list[ChangeOrder]:
    r = await db.execute(select(ChangeOrder).where(ChangeOrder.project_id == project_id).order_by(ChangeOrder.created_at.desc()))
    return list(r.scalars().all())


async def approve(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    co = await db.get(ChangeOrder, order_id)
    if not co or co.status != ChangeOrderStatus.pending:
        return None
    co.status = ChangeOrderStatus.approved
    await apply_change_order_to_budget(db, co)
    from app.services.budget_service import sync_project_budget_planned
    await sync_project_budget_planned(db, co.project_id)
    await db.commit()
    await db.refresh(co)
    return co


async def reject(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    co = await db.get(ChangeOrder, order_id)
    if not co or co.status != ChangeOrderStatus.pending:
        return None
    co.status = ChangeOrderStatus.rejected
    await db.commit()
    await db.refresh(co)
    return co
