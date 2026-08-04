"""Canonical replay-safe Renova Pro checkout and YooKassa webhook routes."""
from __future__ import annotations

import asyncio
import secrets
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import subscription_checkout_service as checkout_svc
from app.services import yookassa_service as yk
from app.services.webhook_delivery_service import (
    abandon_delivery,
    claim_delivery,
    complete_delivery,
    fail_delivery,
)

router = APIRouter(prefix="/subscription", tags=["subscription"])
_RETRYABLE_REASONS = {
    "payment_not_found",
    "project_not_found",
    "refund_source_not_confirmed",
    "subscription_checkout_not_found",
    "subscription_user_not_found",
}


class SubscriptionCheckoutIn(BaseModel):
    # Explicitly allows purchasing another month during the short replay window.
    new_cycle: bool = False


def _integrity_error(exc: checkout_svc.SubscriptionCheckoutIntegrityError) -> HTTPException:
    code = exc.code
    status_code = 404 if code in {
        "subscription_checkout_not_found",
        "subscription_user_not_found",
    } else 409
    return HTTPException(
        status_code,
        detail={
            "code": code,
            "message": "Не удалось безопасно обработать оплату подписки",
        },
    )


def _provider_error(exc: Exception) -> HTTPException:
    provider_status = None
    if isinstance(exc, httpx.HTTPStatusError):
        provider_status = exc.response.status_code
    return HTTPException(
        502,
        detail={
            "code": "yookassa_unavailable",
            "message": "ЮKassa временно недоступна. Повтор запроса не создаст второй платёж.",
            "provider_status": provider_status,
        },
    )


def _remote_money(obj: dict[str, Any]) -> tuple[Decimal, str]:
    amount_obj = obj.get("amount") or {}
    if not isinstance(amount_obj, dict):
        raise checkout_svc.SubscriptionCheckoutIntegrityError("yookassa_amount_missing")
    try:
        amount = Decimal(str(amount_obj.get("value"))).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise checkout_svc.SubscriptionCheckoutIntegrityError("yookassa_amount_invalid") from exc
    currency = str(amount_obj.get("currency") or "").upper()
    if not currency:
        raise checkout_svc.SubscriptionCheckoutIntegrityError("yookassa_currency_missing")
    return amount, currency


async def _process_subscription_event(
    body: dict[str, Any],
    db: AsyncSession,
) -> dict[str, Any] | None:
    event = str(body.get("event") or "")
    obj = body.get("object") or {}
    if not isinstance(obj, dict):
        return {"ok": False, "handled": False, "reason": "invalid_object"}

    metadata = obj.get("metadata") or {}
    if not isinstance(metadata, dict) or metadata.get("kind") != "pro_subscription":
        return None

    checkout_id = str(metadata.get("subscription_checkout_id") or "")
    # Rolling-deploy compatibility: old in-flight subscription payments did not
    # carry a checkout id and remain handled by the legacy processor.
    if not checkout_id:
        return None
    user_id = str(metadata.get("user_id") or "")
    provider_id = str(obj.get("id") or "")
    if not user_id or not provider_id:
        return {"ok": False, "handled": False, "reason": "missing_subscription_metadata"}

    amount, currency = _remote_money(obj)
    if event == "payment.succeeded" and obj.get("status") == "succeeded":
        checkout, changed = await checkout_svc.complete_checkout(
            db,
            checkout_id=checkout_id,
            user_id=user_id,
            provider_payment_id=provider_id,
            amount=amount,
            currency=currency,
            commit=False,
        )
        return {
            "ok": True,
            "handled": True,
            "activated": changed,
            "duplicate": not changed,
            "checkout_id": checkout.id,
            "user_id": user_id,
        }

    if event == "payment.canceled" and obj.get("status") == "canceled":
        cancellation = obj.get("cancellation_details") or {}
        reason = cancellation.get("reason") if isinstance(cancellation, dict) else None
        checkout, changed = await checkout_svc.cancel_checkout(
            db,
            checkout_id=checkout_id,
            user_id=user_id,
            provider_payment_id=provider_id,
            amount=amount,
            currency=currency,
            reason=str(reason or "payment.canceled"),
            commit=False,
        )
        return {
            "ok": True,
            "handled": True,
            "canceled": changed,
            "duplicate": not changed,
            "checkout_id": checkout.id,
            "user_id": user_id,
        }

    return {
        "ok": True,
        "handled": False,
        "reason": "unsupported_subscription_event",
    }


@router.post("/checkout")
async def checkout(
    body: SubscriptionCheckoutIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create, resume or replay exactly one Pro renewal purchase."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Renova Pro доступен исполнителю")

    checkout_row, created = await checkout_svc.get_or_create_checkout(
        db,
        user_id=user.id,
        force_new=bool(body and body.new_cycle),
    )
    if checkout_row.status == "succeeded":
        return {
            **checkout_svc.checkout_payload(checkout_row, replay=True),
            "demo": yk.demo_allowed() and not yk.yookassa_configured(),
            "payments_mode": "demo" if yk.demo_allowed() and not yk.yookassa_configured() else "live",
            "message": "Оплата уже подтверждена; повторное начисление не выполнено",
        }

    return_url = "renova://subscription-return"
    try:
        provider = await checkout_svc.create_or_resume_provider_payment(
            checkout_row,
            return_url=return_url,
        )
    except (httpx.HTTPError, TimeoutError) as exc:
        raise _provider_error(exc) from exc

    if provider.get("error") == "yookassa_not_configured":
        raise HTTPException(503, provider.get("message", "ЮKassa не настроена"))

    try:
        provider_id = checkout_svc.validate_provider_snapshot(
            provider,
            checkout=checkout_row,
        )
        checkout_row = await checkout_svc.bind_provider_payment(
            db,
            checkout_id=checkout_row.id,
            user_id=user.id,
            provider_payment_id=provider_id,
            confirmation_url=provider.get("confirmation_url"),
            provider_status=str(provider.get("status") or "pending"),
            commit=False,
        )
    except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
        await db.rollback()
        raise _integrity_error(exc) from exc

    is_demo = bool(provider.get("demo"))
    provider_status = str(provider.get("status") or "pending")
    if is_demo:
        if not yk.demo_allowed():
            await db.rollback()
            raise HTTPException(503, "Для staging/production нужны ключи ЮKassa")
        try:
            checkout_row, _ = await checkout_svc.complete_checkout(
                db,
                checkout_id=checkout_row.id,
                user_id=user.id,
                provider_payment_id=provider_id,
                amount=checkout_row.amount,
                currency=checkout_row.currency,
                commit=True,
            )
        except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
            await db.rollback()
            raise _integrity_error(exc) from exc
        return {
            **checkout_svc.checkout_payload(checkout_row, replay=not created),
            "demo": True,
            "payments_mode": "demo",
            "message": "Renova Pro активирован на 30 дней (demo)",
        }

    if provider_status == "succeeded" and not provider.get("loaded_from_provider"):
        try:
            provider = await checkout_svc.load_provider_payment(
                provider_id,
                return_url=return_url,
            )
            checkout_svc.validate_provider_snapshot(provider, checkout=checkout_row)
        except (httpx.HTTPError, TimeoutError) as exc:
            await db.rollback()
            raise _provider_error(exc) from exc
        except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
            await db.rollback()
            raise _integrity_error(exc) from exc
        provider_status = str(provider.get("status") or "")

    if provider_status == "succeeded":
        try:
            checkout_row, _ = await checkout_svc.complete_checkout(
                db,
                checkout_id=checkout_row.id,
                user_id=user.id,
                provider_payment_id=provider_id,
                amount=provider.get("remote_amount"),
                currency=str(provider.get("remote_currency") or ""),
                commit=True,
            )
        except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
            await db.rollback()
            raise _integrity_error(exc) from exc
    elif provider_status == "canceled":
        try:
            checkout_row, _ = await checkout_svc.cancel_checkout(
                db,
                checkout_id=checkout_row.id,
                user_id=user.id,
                provider_payment_id=provider_id,
                amount=provider.get("remote_amount"),
                currency=str(provider.get("remote_currency") or ""),
                reason=provider.get("cancellation_reason"),
                commit=True,
            )
        except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
            await db.rollback()
            raise _integrity_error(exc) from exc
    elif provider_status in {"pending", "waiting_for_capture"}:
        await db.commit()
        checkout_row = await db.get(type(checkout_row), checkout_row.id) or checkout_row
    else:
        await db.rollback()
        raise HTTPException(
            409,
            detail={
                "code": "unsupported_yookassa_status",
                "provider_status": provider_status,
            },
        )

    return {
        **checkout_svc.checkout_payload(checkout_row, replay=not created),
        "demo": False,
        "payments_mode": "live",
        "message": "Платёж восстановлен" if not created else None,
    }


@router.post("/webhook")
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate, claim and atomically settle project or subscription events."""
    ip = request.client.host if request.client else None
    if not yk.check_webhook_ip(ip):
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
        event_kind, _provider_object, event_key = yk.validate_webhook_envelope(body)
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
        try:
            result = await _process_subscription_event(body, db)
        except checkout_svc.SubscriptionCheckoutIntegrityError as exc:
            result = {
                "ok": False,
                "handled": False,
                "reason": exc.code,
                "retryable": exc.code in _RETRYABLE_REASONS,
            }
        if result is None:
            result = await yk.process_webhook(body, db)

        reason = str(result.get("reason") or "")
        if reason in _RETRYABLE_REASONS:
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
