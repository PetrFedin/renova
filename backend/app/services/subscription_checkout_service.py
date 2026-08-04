"""Idempotent Renova Pro checkout and entitlement settlement."""
from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timeutil import utc_now
from app.models.entities import User, UserRole
from app.models.subscription_checkout import SubscriptionCheckout
from app.services import yookassa_service as yk
from app.services.subscription_service import PRO_DAYS, PRO_PRICE, activate_pro, get_sub

OPEN_STATUSES = {"pending", "processing"}
REPLAY_WINDOW = timedelta(minutes=15)


class SubscriptionCheckoutIntegrityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _money(payload: dict[str, Any]) -> tuple[Decimal | None, str | None]:
    amount = payload.get("amount") or {}
    if not isinstance(amount, dict):
        return None, None
    try:
        value = Decimal(str(amount.get("value"))).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        value = None
    currency = str(amount.get("currency") or "").upper() or None
    return value, currency


def _confirmation_url(payload: dict[str, Any]) -> str | None:
    confirmation = payload.get("confirmation") or {}
    if not isinstance(confirmation, dict):
        return None
    value = confirmation.get("confirmation_url")
    return str(value) if value else None


async def get_or_create_checkout(
    db: AsyncSession,
    *,
    user_id: str,
    force_new: bool = False,
) -> tuple[SubscriptionCheckout, bool]:
    """Return one open/replay checkout or persist a new financial identity."""
    await get_sub(db, user_id, commit=False, for_update=True)

    open_checkout = (
        await db.execute(
            select(SubscriptionCheckout)
            .where(SubscriptionCheckout.open_key == user_id)
            .order_by(SubscriptionCheckout.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if open_checkout is not None:
        await db.commit()
        return open_checkout, False

    if not force_new:
        now = utc_now()
        replay = (
            await db.execute(
                select(SubscriptionCheckout)
                .where(
                    SubscriptionCheckout.user_id == user_id,
                    SubscriptionCheckout.status == "succeeded",
                    SubscriptionCheckout.replay_until.is_not(None),
                    SubscriptionCheckout.replay_until > now,
                )
                .order_by(SubscriptionCheckout.completed_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if replay is not None:
            await db.commit()
            return replay, False

    checkout_id = str(uuid.uuid4())
    checkout = SubscriptionCheckout(
        id=checkout_id,
        user_id=user_id,
        open_key=user_id,
        status="pending",
        amount=PRO_PRICE,
        currency="RUB",
        days=PRO_DAYS,
        idempotence_key=f"pro-{checkout_id}",
    )
    db.add(checkout)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        winner = (
            await db.execute(
                select(SubscriptionCheckout)
                .where(SubscriptionCheckout.open_key == user_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if winner is None:
            await db.rollback()
            raise SubscriptionCheckoutIntegrityError(
                "subscription_checkout_create_conflict"
            ) from exc
        await db.commit()
        return winner, False
    await db.refresh(checkout)
    return checkout, True


async def load_provider_payment(
    provider_payment_id: str,
    *,
    return_url: str,
) -> dict[str, Any]:
    """Recover one provider payment after a lost checkout response."""
    if not yk.yookassa_configured():
        if yk.demo_allowed():
            return {
                "demo": True,
                "loaded_from_provider": False,
                "payment_id": provider_payment_id,
                "confirmation_url": return_url,
                "status": "pending",
            }
        return {
            "demo": False,
            "error": "yookassa_not_configured",
            "message": "На сервере не настроены ключи ЮKassa",
        }

    auth = (settings.yookassa_shop_id, settings.yookassa_secret)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"https://api.yookassa.ru/v3/payments/{provider_payment_id}",
            auth=auth,
        )
        response.raise_for_status()
        data = response.json()

    remote_amount, remote_currency = _money(data)
    cancellation = data.get("cancellation_details") or {}
    cancellation_reason = None
    if isinstance(cancellation, dict):
        cancellation_reason = str(cancellation.get("reason") or "").strip() or None
    return {
        "demo": False,
        "loaded_from_provider": True,
        "payment_id": str(data.get("id") or ""),
        "confirmation_url": _confirmation_url(data),
        "status": str(data.get("status") or ""),
        "remote_amount": remote_amount,
        "remote_currency": remote_currency,
        "metadata": data.get("metadata"),
        "cancellation_reason": cancellation_reason,
    }


async def create_or_resume_provider_payment(
    checkout: SubscriptionCheckout,
    *,
    return_url: str,
) -> dict[str, Any]:
    if checkout.provider_payment_id:
        return await load_provider_payment(
            checkout.provider_payment_id,
            return_url=return_url,
        )
    result = await yk.create_payment(
        checkout.amount,
        "Renova Pro — 30 дней",
        return_url,
        checkout.user_id,
        checkout.idempotence_key,
        metadata={
            "kind": "pro_subscription",
            "user_id": checkout.user_id,
            "subscription_checkout_id": checkout.id,
        },
    )
    return {**result, "loaded_from_provider": False}


def validate_provider_snapshot(
    snapshot: dict[str, Any],
    *,
    checkout: SubscriptionCheckout,
) -> str:
    provider_id = str(snapshot.get("payment_id") or "").strip()
    if not provider_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_missing")
    if checkout.provider_payment_id and checkout.provider_payment_id != provider_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")

    if snapshot.get("loaded_from_provider"):
        remote_amount = snapshot.get("remote_amount")
        remote_currency = snapshot.get("remote_currency")
        expected_amount = Decimal(str(checkout.amount)).quantize(Decimal("0.01"))
        if remote_amount is None or remote_amount != expected_amount:
            raise SubscriptionCheckoutIntegrityError("yookassa_amount_mismatch")
        if remote_currency != checkout.currency:
            raise SubscriptionCheckoutIntegrityError("yookassa_currency_mismatch")
        metadata = snapshot.get("metadata")
        if not isinstance(metadata, dict):
            raise SubscriptionCheckoutIntegrityError("yookassa_metadata_missing")
        expected_metadata = {
            "kind": "pro_subscription",
            "user_id": checkout.user_id,
            "subscription_checkout_id": checkout.id,
        }
        for key, expected in expected_metadata.items():
            if str(metadata.get(key) or "") != expected:
                raise SubscriptionCheckoutIntegrityError(f"yookassa_metadata_{key}_mismatch")
    return provider_id


async def bind_provider_payment(
    db: AsyncSession,
    *,
    checkout_id: str,
    user_id: str,
    provider_payment_id: str,
    confirmation_url: str | None,
    provider_status: str,
    commit: bool = True,
) -> SubscriptionCheckout:
    provider_payment_id = provider_payment_id.strip()
    if not provider_payment_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_missing")

    current = await db.get(SubscriptionCheckout, checkout_id)
    if current is None or current.user_id != user_id:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_found")
    if current.status == "succeeded" and current.provider_payment_id == provider_payment_id:
        return current
    if current.status not in OPEN_STATUSES:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_open")
    if current.provider_payment_id and current.provider_payment_id != provider_payment_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")

    try:
        result = await db.execute(
            update(SubscriptionCheckout)
            .where(
                SubscriptionCheckout.id == checkout_id,
                SubscriptionCheckout.user_id == user_id,
                SubscriptionCheckout.status.in_(OPEN_STATUSES),
                SubscriptionCheckout.open_key == user_id,
            )
            .values(
                provider_payment_id=provider_payment_id,
                confirmation_url=confirmation_url,
                provider_status=provider_status,
                status="processing",
                updated_at=utc_now(),
            )
        )
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        owner_id = await db.scalar(
            select(SubscriptionCheckout.id).where(
                SubscriptionCheckout.provider_payment_id == provider_payment_id
            )
        )
        await db.rollback()
        if owner_id and owner_id != checkout_id:
            raise SubscriptionCheckoutIntegrityError(
                "yookassa_payment_id_conflict"
            ) from exc
        raise SubscriptionCheckoutIntegrityError(
            "subscription_checkout_bind_conflict"
        ) from exc

    if result.rowcount != 1:
        await db.rollback()
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_bind_race")
    await db.refresh(current)
    if commit:
        await db.commit()
    return current


async def _locked_checkout(
    db: AsyncSession,
    *,
    checkout_id: str,
) -> SubscriptionCheckout | None:
    query = select(SubscriptionCheckout).where(SubscriptionCheckout.id == checkout_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def complete_checkout(
    db: AsyncSession,
    *,
    checkout_id: str,
    user_id: str,
    provider_payment_id: str,
    amount: Decimal | float,
    currency: str,
    commit: bool = True,
) -> tuple[SubscriptionCheckout, bool]:
    """Settle one purchase exactly once and stack its paid days."""
    checkout = await _locked_checkout(db, checkout_id=checkout_id)
    if checkout is None or checkout.user_id != user_id:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_found")
    if checkout.status == "succeeded":
        if checkout.provider_payment_id != provider_payment_id:
            raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")
        if commit:
            await db.commit()
        return checkout, False
    if checkout.status not in OPEN_STATUSES:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_open")

    expected_amount = Decimal(str(checkout.amount)).quantize(Decimal("0.01"))
    actual_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if actual_amount != expected_amount:
        raise SubscriptionCheckoutIntegrityError("yookassa_amount_mismatch")
    if currency.upper() != checkout.currency:
        raise SubscriptionCheckoutIntegrityError("yookassa_currency_mismatch")
    if checkout.provider_payment_id and checkout.provider_payment_id != provider_payment_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")

    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise SubscriptionCheckoutIntegrityError("subscription_user_not_found")
    if user.role != UserRole.contractor:
        raise SubscriptionCheckoutIntegrityError("subscription_role_forbidden")

    subscription = await get_sub(db, user_id, commit=False, for_update=True)
    checkout.entitlement_before_status = subscription.status.value
    checkout.entitlement_before_plan = subscription.plan
    checkout.entitlement_before_expires_at = subscription.expires_at

    checkout.provider_payment_id = provider_payment_id
    checkout.provider_status = "succeeded"
    checkout.status = "succeeded"
    checkout.open_key = None
    checkout.completed_at = utc_now()
    checkout.replay_until = checkout.completed_at + REPLAY_WINDOW
    checkout.updated_at = checkout.completed_at
    activated = await activate_pro(
        db,
        user_id,
        days=checkout.days,
        commit=False,
    )
    checkout.entitlement_after_expires_at = activated.expires_at
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(checkout)
    return checkout, True


async def cancel_checkout(
    db: AsyncSession,
    *,
    checkout_id: str,
    user_id: str,
    provider_payment_id: str,
    amount: Decimal | float,
    currency: str,
    reason: str | None = None,
    commit: bool = True,
) -> tuple[SubscriptionCheckout, bool]:
    checkout = await _locked_checkout(db, checkout_id=checkout_id)
    if checkout is None or checkout.user_id != user_id:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_found")
    if checkout.status == "canceled":
        if checkout.provider_payment_id != provider_payment_id:
            raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")
        if commit:
            await db.commit()
        return checkout, False
    if checkout.status not in OPEN_STATUSES:
        raise SubscriptionCheckoutIntegrityError("subscription_checkout_not_open")

    expected_amount = Decimal(str(checkout.amount)).quantize(Decimal("0.01"))
    actual_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if actual_amount != expected_amount:
        raise SubscriptionCheckoutIntegrityError("yookassa_amount_mismatch")
    if currency.upper() != checkout.currency:
        raise SubscriptionCheckoutIntegrityError("yookassa_currency_mismatch")
    if checkout.provider_payment_id and checkout.provider_payment_id != provider_payment_id:
        raise SubscriptionCheckoutIntegrityError("yookassa_payment_id_mismatch")

    now = utc_now()
    checkout.provider_payment_id = provider_payment_id
    checkout.provider_status = "canceled"
    checkout.status = "canceled"
    checkout.open_key = None
    checkout.completed_at = now
    checkout.replay_until = None
    checkout.updated_at = now
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(checkout)
    return checkout, True


def checkout_payload(checkout: SubscriptionCheckout, *, replay: bool = False) -> dict[str, Any]:
    return {
        "ok": True,
        "checkout_id": checkout.id,
        "payment_id": checkout.provider_payment_id,
        "confirmation_url": checkout.confirmation_url,
        "status": checkout.provider_status or checkout.status,
        "checkout_status": checkout.status,
        "amount": round(float(checkout.amount), 2),
        "currency": checkout.currency,
        "days": checkout.days,
        "replay": replay,
    }
