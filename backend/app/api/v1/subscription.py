from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services.subscription_service import PRO_PRICE, activate_pro, start_trial, subscription_payload
from app.services.yookassa_service import create_payment, check_webhook_ip, remember_webhook_durable, process_webhook, demo_allowed
from app.core.config import settings

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("/yookassa/health")
async def yookassa_health_probe(user: User = Depends(get_current_user)):
    """P4: staging readiness для ЮKassa (без секретов)."""
    from app.services.yookassa_service import yookassa_health
    _ = user
    return yookassa_health()


@router.get("/me")
async def my_sub(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await subscription_payload(db, user.id)


@router.post("/start-trial")
async def start_pro_trial(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """H1.1: 14 дней Pro без карты (один раз)."""
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    sub, result = await start_trial(db, user.id)
    if result.get("code") == "trial_used":
        raise HTTPException(409, detail=result)
    if result.get("code") == "already_active":
        return {"ok": True, **result, **(await subscription_payload(db, user.id))}
    return {"ok": True, **result, **(await subscription_payload(db, user.id))}

@router.post("/checkout")
async def checkout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    # Deep link return — не localhost (H0 honesty для TestFlight)
    return_url = "renova://subscription-return"
    pay = await create_payment(
        PRO_PRICE,
        "Renova Pro — 30 дней",
        return_url,
        user.id,
        f"pro-{user.id}",
        metadata={"kind": "pro_subscription", "user_id": user.id},
    )
    if pay.get("error") == "yookassa_not_configured":
        raise HTTPException(503, pay.get("message", "ЮKassa not configured"))
    if pay.get("demo"):
        if not demo_allowed():
            raise HTTPException(503, "ЮKassa keys required in staging/production")
        await activate_pro(db, user.id)
        return {
            "ok": True,
            "demo": True,
            "message": "Pro активирован в demo-режиме (development). Staging/prod требуют YOOKASSA_* ключи.",
            "payments_mode": "demo",
        }
    return {**pay, "demo": False, "payments_mode": "live"}

@router.post("/webhook")
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """ЮKassa: payment.succeeded → activate Pro / project payment."""
    ip = request.client.host if request.client else None
    if not check_webhook_ip(ip):
        raise HTTPException(403, "ip denied")
    env = settings.normalized_environment
    secret = (settings.yookassa_webhook_secret or "").strip()
    # P0: staging/production — secret обязателен (нельзя skip)
    if env in ("staging", "production"):
        if not secret:
            raise HTTPException(503, "yookassa_webhook_secret_not_configured")
        if request.headers.get("X-Webhook-Secret") != secret:
            raise HTTPException(401, "invalid webhook")
    elif secret and request.headers.get("X-Webhook-Secret") != secret:
        raise HTTPException(401, "invalid webhook")
    body = await request.json()
    eid = body.get('object', {}).get('id') or body.get('event', '')
    if eid and not await remember_webhook_durable(db, str(eid), kind=str((body or {}).get("event") or "")):
        return {"ok": True, "duplicate": True}
    event = body.get("event")
    obj = body.get("object") or {}
    result = await process_webhook(body, db)
    return result
