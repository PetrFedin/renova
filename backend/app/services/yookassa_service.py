"""ЮKassa: создание платежа, webhook idempotency, project checkout."""
from __future__ import annotations

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
    if settings.environment != "production":
        return True
    if not client_ip:
        return False
    import ipaddress

    ip = ipaddress.ip_address(client_ip)
    for cidr in YOOKASSA_IPS:
        if "/" in cidr:
            if ip in ipaddress.ip_network(cidr, strict=False):
                return True
        elif client_ip == cidr:
            return True
    return False


def remember_webhook(event_id: str) -> bool:
    """In-memory fast path (single process). Prefer remember_webhook_durable in handlers."""
    if event_id in _seen_keys:
        return False
    _seen_keys.add(event_id)
    return True


async def remember_webhook_durable(db, event_id: str, *, kind: str | None = None) -> bool:
    """True = first time (process). False = duplicate. Survives restart via payment_webhook_events."""
    from sqlalchemy.exc import IntegrityError
    from app.models.entities import PaymentWebhookEvent

    if event_id in _seen_keys:
        return False
    row = PaymentWebhookEvent(event_id=event_id, provider="yookassa", payload_kind=kind)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        _seen_keys.add(event_id)
        return False
    _seen_keys.add(event_id)
    return True


async def process_webhook(body: dict[str, Any], db: AsyncSession) -> dict[str, Any]:
    """Единый обработчик: Pro subscription и project payment."""
    event = body.get("event")
    obj = body.get("object") or {}
    if event != "payment.succeeded" or obj.get("status") != "succeeded":
        return {"ok": True, "handled": False}

    metadata = obj.get("metadata") or {}
    kind = metadata.get("kind", "pro_subscription")

    if kind == "project_payment":
        from app.services import payment_service as pay_svc
        from sqlalchemy import select
        from app.models.entities import Payment

        payment_id = metadata.get("payment_id")
        project_id = metadata.get("project_id")
        yk_id = obj.get("id")
        if not payment_id or not project_id:
            return {"ok": True, "handled": False, "reason": "missing_metadata"}

        # P0: lock row (PG); SQLite ignores / best-effort
        q = select(Payment).where(Payment.id == payment_id)
        try:
            q = q.with_for_update()
        except Exception:
            pass
        existing = (await db.execute(q)).scalar_one_or_none()
        if not existing or existing.project_id != project_id:
            return {"ok": True, "handled": False, "reason": "payment_not_found"}
        if existing.status.value not in ("pending", "processing", "paid_unverified"):
            return {"ok": True, "handled": True, "duplicate": True}

        # Verify amount / currency against provider payload
        amount_obj = obj.get("amount") or {}
        try:
            remote_amount = float(amount_obj.get("value") or 0)
        except (TypeError, ValueError):
            remote_amount = 0.0
        remote_currency = str(amount_obj.get("currency") or "RUB").upper()
        if remote_currency != "RUB":
            return {"ok": True, "handled": False, "reason": "currency_mismatch"}
        if abs(remote_amount - float(existing.amount)) > 0.01:
            return {"ok": True, "handled": False, "reason": "amount_mismatch", "expected": existing.amount, "got": remote_amount}
        if existing.yookassa_payment_id and yk_id and existing.yookassa_payment_id != yk_id:
            return {"ok": True, "handled": False, "reason": "yookassa_id_mismatch"}

        if yk_id:
            await pay_svc.attach_yookassa_id(db, payment_id, yk_id)
        confirmed = await pay_svc.confirm_payment(
            db,
            payment_id,
            project_id=project_id,
            allow_without_acceptance=False,
            allow_without_settlement=True,  # payment.succeeded — machine settlement
        )
        if not confirmed:
            return {"ok": True, "handled": True, "blocked": "acceptance_required"}

        from app.models.entities import Project
        from app.services import activity_service as act
        from app.services import notification_service as notif

        project = await db.get(Project, project_id)
        if project:
            await act.log_event(
                db,
                project_id=project_id,
                user_id=metadata.get("user_id") or project.customer_id,
                kind="PaymentApproved",
                title=f"Оплата (ЮKassa): {confirmed.title}",
                body=str(confirmed.amount),
                link_path="/(customer)/(tabs)/budget",
            )
            for member_id in {project.customer_id, project.contractor_id, project.foreman_id}:
                if not member_id:
                    continue
                await notif.notify(
                    db,
                    user_id=member_id,
                    project_id=project_id,
                    notification_type="payment_pending",
                    title=f"Оплата через ЮKassa: {confirmed.title}",
                    body=str(confirmed.amount),
                    link_path="/(customer)/(tabs)/budget"
                    if member_id == project.customer_id
                    else "/(contractor)/(tabs)/budget",
                )
        return {"ok": True, "handled": True, "payment_id": payment_id, "confirmed": True}

    uid = metadata.get("user_id")
    if uid:
        from app.services.subscription_service import activate_pro

        await activate_pro(db, uid)
        return {"ok": True, "handled": True, "pro_user_id": uid}
    return {"ok": True, "handled": False}
