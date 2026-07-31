"""ЮKassa: создание платежа, webhook delivery integrity, project checkout."""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

_seen_keys: set[str] = set()
YOOKASSA_IPS = {
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11",
    "77.75.156.35",
    "2a02:5180::/32",
}


def yookassa_configured() -> bool:
    return bool(settings.yookassa_shop_id and settings.yookassa_secret)


def demo_allowed() -> bool:
    """Demo instant pay только development/test — не staging/production."""
    return settings.normalized_environment in ("development", "test")


def yookassa_health() -> dict[str, Any]:
    """P4 staging probe — без секретов, только флаги готовности."""
    base = (settings.public_base_url or "http://127.0.0.1:8100").rstrip("/")
    configured = yookassa_configured()
    env = settings.normalized_environment
    return {
        "environment": env,
        "configured": configured,
        "shop_id_set": bool(settings.yookassa_shop_id),
        "secret_set": bool(settings.yookassa_secret),
        "webhook_secret_set": bool(settings.yookassa_webhook_secret),
        "demo_allowed": demo_allowed(),
        "live_checkout_ready": configured and env in ("staging", "production"),
        "webhook_url": f"{base}/api/v1/subscription/webhook",
        "return_scheme": "renova://payment-return",
        "hint": (
            None
            if configured
            else "Задайте YOOKASSA_SHOP_ID + YOOKASSA_SECRET (и YOOKASSA_WEBHOOK_SECRET) для staging/production"
        ),
    }


async def create_payment(
    amount: float,
    description: str,
    return_url: str,
    user_id: str | None = None,
    idempotence_key: str | None = None,
    metadata: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not yookassa_configured():
        if not demo_allowed():
            return {
                "demo": False,
                "error": "yookassa_not_configured",
                "message": "На сервере не настроены ключи ЮKassa (YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY)",
            }
        return {
            "demo": True,
            "payment_id": str(uuid.uuid4()),
            "confirmation_url": return_url,
            "status": "pending",
        }
    auth = (settings.yookassa_shop_id, settings.yookassa_secret)
    payload: dict[str, Any] = {
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "confirmation": {"type": "redirect", "return_url": return_url},
        "capture": True,
        "description": description[:128],
    }
    meta: dict[str, str] = {}
    if user_id:
        meta["user_id"] = user_id
    if metadata:
        meta.update(metadata)
    if meta:
        payload["metadata"] = meta
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            "https://api.yookassa.ru/v3/payments",
            json=payload,
            auth=auth,
            headers={"Idempotence-Key": idempotence_key or str(uuid.uuid4())},
        )
        r.raise_for_status()
        d = r.json()
        return {
            "demo": False,
            "payment_id": d["id"],
            "confirmation_url": d["confirmation"]["confirmation_url"],
            "status": d["status"],
        }


def check_webhook_ip(client_ip: str | None) -> bool:
    if settings.normalized_environment != "production":
        return True
    if not client_ip:
        return False
    import ipaddress

    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for cidr in YOOKASSA_IPS:
        if "/" in cidr:
            if ip in ipaddress.ip_network(cidr, strict=False):
                return True
        elif client_ip == cidr:
            return True
    return False


def webhook_event_key(body: dict[str, Any]) -> str | None:
    """A provider object may emit multiple event types; identity must include both."""
    event = str(body.get("event") or "").strip()
    obj = body.get("object") or {}
    if not isinstance(obj, dict):
        return None
    object_id = str(obj.get("id") or obj.get("payment_id") or "").strip()
    if not event or not object_id:
        return None
    raw = f"{event}:{object_id}"
    if len(raw) <= 128:
        return raw
    return f"yk:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def validate_webhook_envelope(body: dict[str, Any]) -> tuple[str, dict[str, Any], str]:
    if not isinstance(body, dict):
        raise ValueError("invalid_webhook_body")
    event = str(body.get("event") or "").strip()
    obj = body.get("object")
    if not event or not isinstance(obj, dict):
        raise ValueError("invalid_webhook_envelope")
    event_key = webhook_event_key(body)
    if not event_key:
        raise ValueError("missing_provider_object_id")
    return event, obj, event_key


async def was_webhook_processed(db: AsyncSession, event_key: str) -> bool:
    """Read-only compatibility check for legacy and claimed completions."""
    from app.models.entities import PaymentWebhookEvent
    from app.models.webhook_runtime import PaymentWebhookDelivery

    if event_key in _seen_keys:
        return True
    row = await db.get(PaymentWebhookEvent, event_key)
    if row:
        _seen_keys.add(event_key)
        return True
    delivery = await db.get(PaymentWebhookDelivery, event_key)
    if delivery and delivery.completed_at is not None:
        _seen_keys.add(event_key)
        return True
    return False


async def record_webhook_processed(
    db: AsyncSession,
    event_key: str,
    *,
    kind: str | None = None,
) -> bool:
    """Legacy completion helper retained for backward-compatible callers."""
    from sqlalchemy.exc import IntegrityError
    from app.models.entities import PaymentWebhookEvent

    if event_key in _seen_keys:
        return False
    db.add(PaymentWebhookEvent(event_id=event_key, provider="yookassa", payload_kind=kind))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        _seen_keys.add(event_key)
        return False
    _seen_keys.add(event_key)
    return True


def remember_webhook(event_id: str) -> bool:
    """Legacy single-process helper; production handlers use completion recording."""
    if event_id in _seen_keys:
        return False
    _seen_keys.add(event_id)
    return True


async def remember_webhook_durable(db, event_id: str, *, kind: str | None = None) -> bool:
    """Compatibility wrapper. New handlers must call it only after successful processing."""
    if await was_webhook_processed(db, event_id):
        return False
    return await record_webhook_processed(db, event_id, kind=kind)


def _remote_money(obj: dict[str, Any]) -> tuple[float, str]:
    amount_obj = obj.get("amount") or {}
    try:
        amount = round(float(amount_obj.get("value") or 0), 2)
    except (TypeError, ValueError):
        amount = 0.0
    return amount, str(amount_obj.get("currency") or "").upper()


async def process_webhook(body: dict[str, Any], db: AsyncSession) -> dict[str, Any]:
    """Prepare one provider transition; the endpoint owns the final commit."""
    event = str(body.get("event") or "")
    obj = body.get("object") or {}
    if not isinstance(obj, dict):
        return {"ok": False, "handled": False, "reason": "invalid_object"}

    if event in {"payment.canceled", "refund.succeeded"}:
        from app.services.payment_reversal_service import process_provider_reversal

        reversal = await process_provider_reversal(body, db, commit=False)
        return {
            "ok": True,
            "handled": reversal.handled,
            "changed": reversal.changed,
            "payment_id": reversal.payment_id,
            "reason": reversal.reason,
        }

    if event != "payment.succeeded" or obj.get("status") != "succeeded":
        return {"ok": True, "handled": False, "reason": "unsupported_event"}

    metadata = obj.get("metadata") or {}
    if not isinstance(metadata, dict):
        return {"ok": True, "handled": False, "reason": "invalid_metadata"}
    kind = str(metadata.get("kind") or "")
    provider_id = str(obj.get("id") or "").strip()
    if not provider_id:
        return {"ok": True, "handled": False, "reason": "missing_provider_object_id"}

    if kind == "project_payment":
        from app.services import payment_service as pay_svc
        from sqlalchemy import select
        from app.models.entities import Payment, Project

        payment_id = str(metadata.get("payment_id") or "")
        project_id = str(metadata.get("project_id") or "")
        provider_user_id = str(metadata.get("user_id") or "")
        if not payment_id or not project_id or not provider_user_id:
            return {"ok": True, "handled": False, "reason": "missing_metadata"}

        q = select(Payment).where(Payment.id == payment_id)
        try:
            q = q.with_for_update()
        except Exception:
            pass
        existing = (await db.execute(q)).scalar_one_or_none()
        if not existing or existing.project_id != project_id:
            return {"ok": True, "handled": False, "reason": "payment_not_found"}
        project = await db.get(Project, project_id)
        if not project or provider_user_id != project.customer_id:
            return {"ok": True, "handled": False, "reason": "payer_mismatch"}
        if existing.status.value not in ("pending", "processing", "paid_unverified"):
            return {"ok": True, "handled": True, "duplicate": True, "payment_id": payment_id}

        remote_amount, remote_currency = _remote_money(obj)
        if remote_currency != "RUB":
            return {"ok": True, "handled": False, "reason": "currency_mismatch"}
        if abs(remote_amount - round(float(existing.amount), 2)) > 0.01:
            return {
                "ok": True,
                "handled": False,
                "reason": "amount_mismatch",
                "expected": existing.amount,
                "got": remote_amount,
            }
        if existing.yookassa_payment_id and existing.yookassa_payment_id != provider_id:
            return {"ok": True, "handled": False, "reason": "yookassa_id_mismatch"}

        await pay_svc.attach_yookassa_id(
            db,
            payment_id,
            provider_id,
            commit=False,
        )
        confirmed = await pay_svc.confirm_payment(
            db,
            payment_id,
            project_id=project_id,
            allow_without_acceptance=False,
            allow_without_settlement=True,
            commit=False,
        )
        if not confirmed:
            return {
                "ok": True,
                "handled": False,
                "retryable": True,
                "blocked": "acceptance_required",
                "payment_id": payment_id,
            }
        return {
            "ok": True,
            "handled": True,
            "payment_id": payment_id,
            "confirmed": True,
        }

    if kind != "pro_subscription":
        return {"ok": True, "handled": False, "reason": "unsupported_payment_kind"}

    uid = str(metadata.get("user_id") or "")
    if not uid:
        return {"ok": True, "handled": False, "reason": "missing_user_id"}

    from app.models.entities import User, UserRole
    from app.services.subscription_service import PRO_PRICE, activate_pro

    remote_amount, remote_currency = _remote_money(obj)
    if remote_currency != "RUB":
        return {"ok": True, "handled": False, "reason": "currency_mismatch"}
    if abs(remote_amount - round(float(PRO_PRICE), 2)) > 0.01:
        return {
            "ok": True,
            "handled": False,
            "reason": "amount_mismatch",
            "expected": PRO_PRICE,
            "got": remote_amount,
        }
    user = await db.get(User, uid)
    if not user or user.deleted_at is not None:
        return {"ok": True, "handled": False, "reason": "user_not_found"}
    if user.role != UserRole.contractor:
        return {"ok": True, "handled": False, "reason": "subscription_role_forbidden"}

    await activate_pro(db, uid, commit=False)
    return {"ok": True, "handled": True, "pro_user_id": uid}
