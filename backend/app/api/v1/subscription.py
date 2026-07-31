import asyncio
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services.subscription_service import PRO_PRICE, activate_pro, start_trial, subscription_payload
from app.services.yookassa_service import (
    create_payment,
    check_webhook_ip,
    process_webhook,
    demo_allowed,
    validate_webhook_envelope,
)
from app.services.webhook_delivery_service import (
    abandon_delivery,
    claim_delivery,
    complete_delivery,
    fail_delivery,
)
from app.core.config import settings

router = APIRouter(prefix="/subscription", tags=["subscription"])
_RETRYABLE_PROVIDER_REASONS = {
    "payment_not_found",
    "project_not_found",
    "refund_source_not_confirmed",
}


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
    """Authenticate, claim, apply and complete one provider event."""
    ip = request.client.host if request.client else None
    if not check_webhook_ip(ip):
        raise HTTPException(403, "ip denied")

    environment = settings.normalized_environment
    configured_secret = (settings.yookassa_webhook_secret or "").strip()
    provided_secret = request.headers.get("X-Webhook-Secret") or ""
    if environment in ("staging", "production") and not configured_secret:
        raise HTTPException(503, "yookassa_webhook_secret_not_configured")
    if configured_secret and not secrets.compare_digest(provided_secret, configured_secret):
        raise HTTPException(401, "invalid webhook")

    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "invalid_webhook_json") from exc
    try:
        event_kind, _provider_object, event_key = validate_webhook_envelope(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None

    claim = await claim_delivery(
        db,
        event_id=event_key,
        event_kind=event_kind,
        worker_id=request.headers.get("X-Correlation-ID") or "api-webhook",
    )
    if claim.status == "completed":
        return {
            "ok": True,
            "accepted": True,
            "business_applied": False,
            "duplicate": True,
            "event_key": event_key,
        }
    if claim.status == "poisoned":
        raise HTTPException(
            503,
            detail={
                "code": "webhook_delivery_poisoned",
                "event_key": event_key,
                "attempts": claim.attempts,
            },
        )
    if claim.status != "acquired" or not claim.token:
        raise HTTPException(
            503,
            detail={"code": "webhook_delivery_busy", "event_key": event_key},
        )

    try:
        result = await process_webhook(body, db)
        reason = str(result.get("reason") or "")
        if reason in _RETRYABLE_PROVIDER_REASONS:
            result["retryable"] = True
        if result.get("retryable"):
            await db.rollback()
            await fail_delivery(
                db,
                event_id=event_key,
                claim_token=claim.token,
                error=str(result.get("blocked") or reason or "retryable"),
            )
            raise HTTPException(
                503,
                detail={
                    "code": "webhook_processing_deferred",
                    "reason": result.get("blocked") or reason,
                },
            )

        handled = bool(result.get("handled"))
        outcome = "handled" if handled else f"ignored:{reason or 'unhandled'}"
        if not await complete_delivery(
            db,
            event_id=event_key,
            claim_token=claim.token,
            event_kind=event_kind,
            outcome=outcome,
        ):
            raise HTTPException(
                503,
                detail={"code": "webhook_claim_lost", "event_key": event_key},
            )
        return {
            **result,
            "accepted": True,
            "business_applied": handled,
            "event_key": event_key,
        }
    except asyncio.CancelledError:
        await db.rollback()
        await abandon_delivery(
            db,
            event_id=event_key,
            claim_token=claim.token,
        )
        raise
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        await fail_delivery(
            db,
            event_id=event_key,
            claim_token=claim.token,
            error=f"{type(exc).__name__}:{exc}",
        )
        raise
