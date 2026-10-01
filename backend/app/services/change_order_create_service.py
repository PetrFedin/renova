"""Transactional create helper for idempotent change-order requests."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChangeOrder


async def prepare_order(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    amount: float,
    description: str | None,
    stage_id: str | None = None,
) -> ChangeOrder:
    order = ChangeOrder(
        project_id=project_id,
        title=title,
        amount=amount,
        description=description,
        stage_id=stage_id,
        created_by=user_id,
    )
    db.add(order)
    await db.flush()
    return order
