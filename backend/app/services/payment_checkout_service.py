"""Replay-safe YooKassa checkout orchestration.

The provider payment id is a financial identity. It may be attached once and may
only be replayed with the same value. Checkout retries use the provider GET API
when a local payment is already processing, so a lost HTTP response does not
force the customer to create another payment.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Payment, PaymentStatus
from app.services import yookassa_service as yk


class CheckoutIntegrityError(ValueError):
    """Fail-closed checkout state or provider identity violation."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _confirmation_url(payload: dict[str, Any]) -> str | None:
    confirmation = payload.get("confirmation") or {}
    if not isinstance(confirmation, dict):
        return None
    value = confirmation.get("confirmation_url")
    return str(value) if value else None


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


def validate_provider_snapshot(
    snapshot: dict[str, Any],
    *,
    expected_provider_id: str | None,
    expected_amount: float,
    expected_project_id: str,
    expected_payment_id: str,
    expected_user_id: str,
) -> str:
    """Validate identity and money on provider GET responses before reuse."""
    provider_id = str(snapshot.get("payment_id") or "").strip()
    if not provider_id:
        raise CheckoutIntegrityError("yookassa_payment_id_missing")
    if expected_provider_id and provider_id != expected_provider_id:
        raise CheckoutIntegrityError("yookassa_payment_id_mismatch")

    remote_amount = snapshot.get("remote_amount")
    remote_currency = snapshot.get("remote_currency")
    if remote_amount is not None:
        expected = Decimal(str(expected_amount)).quantize(Decimal("0.01"))
        if remote_amount != expected:
            raise CheckoutIntegrityError("yookassa_amount_mismatch")
    if remote_currency is not None and remote_currency != "RUB":
        raise CheckoutIntegrityError("yookassa_currency_mismatch")

    metadata = snapshot.get("metadata")
    if isinstance(metadata, dict):
        expected_metadata = {
            "kind": "project_payment",
            "project_id": expected_project_id,
            "payment_id": expected_payment_id,
            "user_id": expected_user_id,
        }
        for key, expected_value in expected_metadata.items():
            actual = metadata.get(key)
            if actual is not None and str(actual) != expected_value:
                raise CheckoutIntegrityError(f"yookassa_metadata_{key}_mismatch")
    return provider_id


async def _load_provider_payment(provider_payment_id: str, return_url: str) -> dict[str, Any]:
    """Recover a provider checkout after the client lost the first response."""
    if not yk.yookassa_configured():
        if yk.demo_allowed():
            return {
                "demo": True,
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
    return {
        "demo": False,
        "payment_id": str(data.get("id") or ""),
        "confirmation_url": _confirmation_url(data),
        "status": str(data.get("status") or ""),
        "remote_amount": remote_amount,
        "remote_currency": remote_currency,
        "metadata": data.get("metadata"),
    }


async def create_or_resume_checkout(
    *,
    amount: float,
    description: str,
    return_url: str,
    user_id: str,
    payment_id: str,
    project_id: str,
    existing_provider_id: str | None,
) -> dict[str, Any]:
    """Create once or reload the already attached provider payment."""
    if existing_provider_id:
        return await _load_provider_payment(existing_provider_id, return_url)
    return await yk.create_payment(
        amount,
        description,
        return_url,
        user_id=user_id,
        idempotence_key=f"proj-pay-{payment_id}",
        metadata={
            "kind": "project_payment",
            "payment_id": payment_id,
            "project_id": project_id,
            "user_id": user_id,
        },
    )


async def bind_provider_payment(
    db: AsyncSession,
    *,
    payment_id: str,
    project_id: str,
    provider_payment_id: str,
    commit: bool = True,
) -> Payment:
    """Atomically attach one provider id; same-id retries are harmless."""
    provider_payment_id = provider_payment_id.strip()
    if not provider_payment_id:
        raise CheckoutIntegrityError("yookassa_payment_id_missing")

    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment_id,
            Payment.project_id == project_id,
            Payment.status.in_({PaymentStatus.pending, PaymentStatus.processing}),
            or_(
                Payment.yookassa_payment_id.is_(None),
                Payment.yookassa_payment_id == provider_payment_id,
            ),
        )
        .values(
            yookassa_payment_id=provider_payment_id,
            payment_method="yookassa",
            status=PaymentStatus.processing,
        )
    )
    if result.rowcount != 1:
        await db.rollback()
        current = await db.get(Payment, payment_id)
        if not current or current.project_id != project_id:
            raise CheckoutIntegrityError("payment_not_found")
        if current.yookassa_payment_id and current.yookassa_payment_id != provider_payment_id:
            raise CheckoutIntegrityError("yookassa_payment_id_mismatch")
        if current.status not in {PaymentStatus.pending, PaymentStatus.processing}:
            raise CheckoutIntegrityError("payment_not_checkoutable")
        raise CheckoutIntegrityError("payment_checkout_race")

    await db.flush()
    if commit:
        await db.commit()
    current = await db.get(Payment, payment_id)
    if not current:
        raise CheckoutIntegrityError("payment_not_found")
    return current
