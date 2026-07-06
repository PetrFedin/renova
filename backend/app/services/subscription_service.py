from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import Subscription, SubscriptionStatus, User

PRO_PRICE = 990.0

async def get_sub(db: AsyncSession, user_id: str) -> Subscription:
    r = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    s = r.scalar_one_or_none()
    if not s:
        s = Subscription(user_id=user_id, status=SubscriptionStatus.free, plan="free")
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s

async def is_pro(db: AsyncSession, user_id: str) -> bool:
    s = await get_sub(db, user_id)
    if s.status != SubscriptionStatus.active:
        return False
    return not s.expires_at or s.expires_at > datetime.utcnow()

async def activate_pro(db: AsyncSession, user_id: str, days: int = 30) -> Subscription:
    s = await get_sub(db, user_id)
    s.status = SubscriptionStatus.active
    s.plan = "pro"
    s.expires_at = datetime.utcnow() + timedelta(days=days)
    await db.commit()
    await db.refresh(s)
    return s
