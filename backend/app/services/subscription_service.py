from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Subscription, SubscriptionStatus

PRO_PRICE = 990.0
PRO_DAYS = 30
TRIAL_DAYS = 14


async def get_sub(
    db: AsyncSession,
    user_id: str,
    *,
    commit: bool = True,
    for_update: bool = False,
) -> Subscription:
    query = select(Subscription).where(Subscription.user_id == user_id)
    if for_update:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    r = await db.execute(query)
    s = r.scalar_one_or_none()
    if not s:
        candidate = Subscription(
            user_id=user_id,
            status=SubscriptionStatus.free,
            plan="free",
        )
        try:
            # Preserve the caller's outer transaction if another request creates
            # the same unique user row while this request is in flight.
            async with db.begin_nested():
                db.add(candidate)
                await db.flush()
            s = candidate
        except IntegrityError:
            s = (await db.execute(query)).scalar_one_or_none()
            if s is None:
                raise
        if commit:
            await db.commit()
            await db.refresh(s)
    return s


async def _expire_if_needed(db: AsyncSession, s: Subscription) -> Subscription:
    """Trial/Pro с истёкшим expires_at → free (trial помечаем trial_used)."""
    if s.status != SubscriptionStatus.active:
        return s
    if not s.expires_at or s.expires_at > utc_now():
        return s
    if s.plan == "trial":
        s.plan = "trial_used"
    elif s.plan == "pro":
        s.plan = "free"
    s.status = SubscriptionStatus.free
    await db.commit()
    await db.refresh(s)
    return s


async def is_pro(db: AsyncSession, user_id: str) -> bool:
    s = await _expire_if_needed(db, await get_sub(db, user_id))
    if s.status != SubscriptionStatus.active:
        return False
    return not s.expires_at or s.expires_at > utc_now()


async def activate_pro(
    db: AsyncSession,
    user_id: str,
    days: int = PRO_DAYS,
    *,
    commit: bool = True,
) -> Subscription:
    """Add paid days without destroying an active trial or paid remainder.

    Idempotency belongs to the persisted subscription checkout. This function
    deliberately stacks one validated purchase on top of the later of ``now``
    and the current entitlement expiry.
    """
    if days <= 0:
        raise ValueError("subscription_days_must_be_positive")
    s = await get_sub(db, user_id, commit=False, for_update=True)
    now = utc_now()
    base = s.expires_at if s.expires_at and s.expires_at > now else now
    s.status = SubscriptionStatus.active
    s.plan = "pro"
    s.expires_at = base + timedelta(days=days)
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(s)
    return s


async def start_trial(db: AsyncSession, user_id: str) -> tuple[Subscription | None, dict]:
    """H1.1: один trial 14 дней на исполнителя."""
    s = await _expire_if_needed(db, await get_sub(db, user_id))
    if s.status == SubscriptionStatus.active and s.plan in ("pro", "trial"):
        return s, {"code": "already_active", "plan": s.plan}
    if s.plan == "trial_used":
        return None, {"code": "trial_used", "message": "Пробный период уже использован — оформите Pro"}
    s.status = SubscriptionStatus.active
    s.plan = "trial"
    s.expires_at = utc_now() + timedelta(days=TRIAL_DAYS)
    await db.commit()
    await db.refresh(s)
    return s, {"code": "trial_started", "days": TRIAL_DAYS}


async def subscription_payload(db: AsyncSession, user_id: str) -> dict:
    from app.core.config import settings
    from app.services.yookassa_service import yookassa_health

    s = await _expire_if_needed(db, await get_sub(db, user_id))
    pro = await is_pro(db, user_id)
    s = await get_sub(db, user_id)  # refresh after is_pro side effects
    days_left = None
    if s.expires_at and pro:
        days_left = max(0, (s.expires_at - utc_now()).days)
    health = yookassa_health()
    return {
        "plan": s.plan,
        "status": s.status.value,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "is_pro": pro,
        "is_trial": pro and s.plan == "trial",
        "trial_available": s.plan not in ("trial", "trial_used", "pro") and not pro,
        "trial_days": TRIAL_DAYS,
        "days_left": days_left,
        "price": PRO_PRICE,
        "free_limit": settings.contractor_free_project_limit,
        "payments_mode": "live" if health.get("live_checkout_ready") else ("demo" if health.get("demo_allowed") else "off"),
        "yookassa": {
            "configured": health.get("configured"),
            "demo_allowed": health.get("demo_allowed"),
            "live_checkout_ready": health.get("live_checkout_ready"),
        },
    }
