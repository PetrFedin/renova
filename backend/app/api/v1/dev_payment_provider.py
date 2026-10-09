"""Local/test control plane for the persistent simulated payment provider.

This router never mutates Renova Payment state directly. It only controls the
simulated provider, then feeds the generated provider event into the canonical
subscription webhook handler so claim/dedupe/reversal semantics stay identical.
"""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services.providers import base, registry
from app.services.providers.errors import ProviderConfigurationError, ProviderRejected
from app.services.providers.simulated.payment import SimulatedPaymentProvider

router = APIRouter(prefix="/dev/providers/payment", tags=["dev-provider-control"])


class TransitionIn(BaseModel):
    action: str


class RefundIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    idempotency_key: str = Field(min_length=1, max_length=128)
    reason: str | None = Field(default=None, max_length=255)


class _InternalWebhookRequest:
    def __init__(self, body: dict[str, Any], correlation_id: str):
        self._body = body
        self.client = SimpleNamespace(host="127.0.0.1")
        self.headers = {"X-Correlation-ID": correlation_id}

    async def json(self) -> dict[str, Any]:
        return self._body


def _provider() -> SimulatedPaymentProvider:
    if settings.normalized_environment not in {"development", "test"}:
        # Hide the dev control plane completely outside working-local profiles.
        raise HTTPException(404, "not_found")
    try:
        provider = registry.payment_provider()
    except ProviderConfigurationError as exc:
        raise HTTPException(
            409,
            detail={"code": exc.code, "message": "Simulated payment provider is not available"},
        ) from exc
    if not isinstance(provider, SimulatedPaymentProvider):
        raise HTTPException(
            409,
            detail={"code": "simulated_payment_required", "message": "PAYMENT_PROVIDER_MODE=simulated required"},
        )
    return provider


async def _apply_event(
    db: AsyncSession,
    *,
    event: base.PaymentEvent,
) -> dict[str, Any]:
    # Import lazily to avoid router import cycles.
    from app.api.v1 import subscription_integrity

    request = _InternalWebhookRequest(event.raw, event.event_key)
    return await subscription_integrity.yookassa_webhook(request, db)


def _provider_conflict(exc: ProviderRejected) -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": exc.code or "simulated_provider_rejected",
            "message": str(exc),
        },
    )


@router.post("/{external_id}/transition")
async def transition(
    external_id: str,
    body: TransitionIn,
    db: AsyncSession = Depends(get_db),
):
    provider = _provider()
    if body.action not in {"succeed", "cancel"}:
        raise HTTPException(422, detail={"code": "invalid_transition_action"})
    try:
        event = provider.transition(external_id, body.action)
    except ProviderRejected as exc:
        raise _provider_conflict(exc) from exc
    webhook = await _apply_event(db, event=event)
    return {
        "ok": True,
        "external_id": external_id,
        "action": body.action,
        "event_key": event.event_key,
        "webhook": webhook,
    }


@router.post("/{external_id}/refund")
async def refund(
    external_id: str,
    body: RefundIn,
    db: AsyncSession = Depends(get_db),
):
    provider = _provider()
    try:
        result = await provider.refund(
            base.RefundRequest(
                payment_external_id=external_id,
                money=base.Money(body.amount),
                idempotency_key=body.idempotency_key,
                reason=body.reason,
            )
        )
        event = provider.refund_event(external_id, result)
    except ProviderRejected as exc:
        raise _provider_conflict(exc) from exc
    webhook = await _apply_event(db, event=event)
    return {
        "ok": True,
        "external_id": external_id,
        "refund_external_id": result.external_id,
        "event_key": event.event_key,
        "webhook": webhook,
    }
