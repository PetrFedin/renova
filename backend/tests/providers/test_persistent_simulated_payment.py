from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.api.v1 import dev_payment_provider
from app.core.config import settings
from app.services.providers import base, registry
from app.services.providers.simulated import payment as sim_payment


def test_simulated_payment_record_roundtrip_preserves_authoritative_state():
    rec = sim_payment._PaymentRecord(
        external_id="sim_persist_1",
        money=base.Money(Decimal("1500.00")),
        status=base.PaymentStatus.SUCCEEDED,
        description="Persistent",
        return_url="renova://payment-return",
        idempotency_key="idem-persist",
        metadata={"project_id": "p1", "payment_id": "pay1"},
        created_at=sim_payment.utcnow(),
        refunded=Decimal("300.00"),
        refunds={
            "r1": base.RefundResult(
                external_id="simr_1",
                status="succeeded",
                money=base.Money(Decimal("300.00")),
            )
        },
        event_seq=4,
    )

    restored = sim_payment._record_from_json(sim_payment._record_to_json(rec))

    assert restored.external_id == rec.external_id
    assert restored.status is base.PaymentStatus.SUCCEEDED
    assert restored.money == rec.money
    assert restored.refunded == Decimal("300.00")
    assert restored.refunds["r1"].money == base.Money(Decimal("300.00"))
    assert restored.event_seq == 4


def test_default_store_uses_redis_when_local_runtime_configures_it(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:6380/0")
    store = sim_payment._default_store()
    assert isinstance(store, sim_payment._RedisStore)


def test_dev_control_plane_is_hidden_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    with pytest.raises(HTTPException) as exc:
        dev_payment_provider._provider()
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_dev_refund_route_exists_and_unknown_payment_is_conflict(monkeypatch):
    monkeypatch.setattr(settings, "environment", "test")
    monkeypatch.setattr(settings, "redis_url", None)
    monkeypatch.setattr(settings, "payment_provider_mode", "simulated")
    registry.reset()
    sim_payment.reset_store()
    try:
        with pytest.raises(HTTPException) as exc:
            await dev_payment_provider.refund(
                "non-existent",
                dev_payment_provider.RefundIn(
                    amount=Decimal("1.00"),
                    idempotency_key="-".join(["gp5", "refund", "contract"]),
                ),
                db=None,
            )
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == "payment_not_found"
    finally:
        registry.reset()
