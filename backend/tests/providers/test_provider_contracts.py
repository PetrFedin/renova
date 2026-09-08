"""Контрактные тесты портов провайдеров.

Правило: один и тот же набор тестов исполняется для каждой реализации порта.
Реальные адаптеры (A4–A6) добавляются в `IMPLEMENTATIONS` c фикстурами
записанных ответов (respx/httpx MockTransport) — доменные ожидания не меняются.

Если реализация не может выполнить контракт — это дефект реализации,
а не повод ослабить контракт.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.providers import base, registry
from app.services.providers.errors import (
    ProviderConfigurationError,
    ProviderRejected,
    SimulatedProviderForbidden,
)
from app.services.providers.simulated import payment as sim_payment


# ---------------------------------------------------------------------------
# Реализации, участвующие в контракте PaymentProvider
# ---------------------------------------------------------------------------

def _simulated_payment() -> tuple[base.PaymentProvider, dict]:
    sim_payment.reset_store()
    provider = sim_payment.SimulatedPaymentProvider()
    # control — реализационно-специфичные хуки, которыми тест доводит платёж
    # до нужного состояния. Для реального адаптера — replay записанного webhook.
    control = {
        "succeed": lambda ext_id: provider.transition(ext_id, "succeed"),
        "cancel": lambda ext_id: provider.transition(ext_id, "cancel"),
        "refund_event": provider.refund_event,
    }
    return provider, control


PAYMENT_IMPLEMENTATIONS = {
    "simulated": _simulated_payment,
    # "yookassa_recorded": _yookassa_recorded,   # A4
}


@pytest.fixture(params=list(PAYMENT_IMPLEMENTATIONS))
def payment_impl(request):
    return PAYMENT_IMPLEMENTATIONS[request.param]()


def _req(idem: str = "idem-1", amount: str = "1500.00") -> base.PaymentCreateRequest:
    return base.PaymentCreateRequest(
        money=base.Money(Decimal(amount)),
        description="Этап 1 — черновые работы",
        return_url="renova://payment-return",
        idempotency_key=idem,
        metadata={"project_id": "p1", "payment_id": "pay1"},
    )


# ---------------------------------------------------------------------------
# PaymentProvider contract
# ---------------------------------------------------------------------------

class TestPaymentProviderContract:
    def test_is_protocol_instance(self, payment_impl):
        provider, _ = payment_impl
        assert isinstance(provider, base.PaymentProvider)
        assert provider.health().mode in {base.ProviderMode.SIMULATED, base.ProviderMode.REAL}

    async def test_create_returns_pending_with_confirmation(self, payment_impl):
        provider, _ = payment_impl
        res = await provider.create_payment(_req())
        assert res.external_id
        assert res.status is base.PaymentStatus.PENDING
        assert res.confirmation_url

    async def test_create_is_idempotent(self, payment_impl):
        provider, _ = payment_impl
        a = await provider.create_payment(_req("k1"))
        b = await provider.create_payment(_req("k1"))
        assert a.external_id == b.external_id

    async def test_same_key_different_amount_is_rejected(self, payment_impl):
        provider, _ = payment_impl
        await provider.create_payment(_req("k2", "100.00"))
        with pytest.raises(ProviderRejected) as exc:
            await provider.create_payment(_req("k2", "200.00"))
        assert exc.value.code == "idempotency_conflict"

    async def test_get_payment_reflects_authoritative_state(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k3"))
        assert (await provider.get_payment(res.external_id)).status is base.PaymentStatus.PENDING
        control["succeed"](res.external_id)
        state = await provider.get_payment(res.external_id)
        assert state.status is base.PaymentStatus.SUCCEEDED
        assert state.captured == base.Money(Decimal("1500.00"))
        assert state.metadata["payment_id"] == "pay1"

    async def test_get_unknown_payment_is_rejected(self, payment_impl):
        provider, _ = payment_impl
        with pytest.raises(ProviderRejected) as exc:
            await provider.get_payment("does-not-exist")
        assert exc.value.code == "payment_not_found"

    async def test_success_event_is_normalized_and_dedupable(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k4"))
        event = control["succeed"](res.external_id)
        assert event.kind is base.PaymentEventKind.PAYMENT_SUCCEEDED
        assert event.payment_external_id == res.external_id
        assert event.money == base.Money(Decimal("1500.00"))
        assert event.event_key.startswith(provider.name)
        assert event.occurred_at.tzinfo is not None
        # Повторный parse того же raw даёт тот же event_key — основа дедупликации webhook.
        again = provider.parse_webhook(body=event.raw, headers={}, client_ip=None)
        assert again.event_key == event.event_key

    async def test_cancel_event(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k5"))
        event = control["cancel"](res.external_id)
        assert event.kind is base.PaymentEventKind.PAYMENT_CANCELED
        assert (await provider.get_payment(res.external_id)).status is base.PaymentStatus.CANCELED

    async def test_cannot_transition_twice(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k6"))
        control["succeed"](res.external_id)
        with pytest.raises(ProviderRejected):
            control["cancel"](res.external_id)

    async def test_refund_requires_success_and_is_idempotent(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k7"))
        with pytest.raises(ProviderRejected) as exc:
            await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("100.00")), "r1"))
        assert exc.value.code == "payment_not_succeeded"

        control["succeed"](res.external_id)
        r1 = await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("500.00")), "r1"))
        r1_again = await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("500.00")), "r1"))
        assert r1.external_id == r1_again.external_id
        assert (await provider.get_payment(res.external_id)).refunded == base.Money(Decimal("500.00"))

    async def test_refund_cannot_exceed_captured(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k8"))
        control["succeed"](res.external_id)
        await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("1000.00")), "r1"))
        with pytest.raises(ProviderRejected) as exc:
            await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("600.00")), "r2"))
        assert exc.value.code == "refund_exceeds_amount"

    async def test_refund_event_is_normalized(self, payment_impl):
        provider, control = payment_impl
        res = await provider.create_payment(_req("k9"))
        control["succeed"](res.external_id)
        refund = await provider.refund(base.RefundRequest(res.external_id, base.Money(Decimal("300.00")), "r1"))
        event = control["refund_event"](res.external_id, refund)
        assert event.kind is base.PaymentEventKind.REFUND_SUCCEEDED
        assert event.refund_external_id == refund.external_id
        assert event.money == base.Money(Decimal("300.00"))

    def test_foreign_or_malformed_webhook_is_rejected(self, payment_impl):
        provider, _ = payment_impl
        with pytest.raises(ProviderRejected):
            provider.parse_webhook(body={"provider": "someone-else", "event": "payment.succeeded"}, headers={}, client_ip=None)
        with pytest.raises(ProviderRejected):
            provider.parse_webhook(body={"provider": provider.name}, headers={}, client_ip=None)


# ---------------------------------------------------------------------------
# Money invariants
# ---------------------------------------------------------------------------

class TestMoney:
    def test_rejects_more_than_two_decimals(self):
        with pytest.raises(ValueError):
            base.Money(Decimal("1.005"))

    def test_rejects_negative(self):
        with pytest.raises(ValueError):
            base.Money(Decimal("-1.00"))

    def test_equality_is_value_based(self):
        assert base.Money(Decimal("10.00")) == base.Money(Decimal("10.00"))


# ---------------------------------------------------------------------------
# Registry / environment policy (fail-closed)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_registry():
    registry.reset()
    yield
    registry.reset()


def test_registry_off_by_default_exposes_unavailable_health(monkeypatch):
    monkeypatch.setattr(registry.settings, "payment_provider_mode", "off", raising=False)
    h = registry.payment_provider().health()
    assert h.mode is base.ProviderMode.OFF and h.available is False


async def test_registry_off_provider_raises_on_use(monkeypatch):
    monkeypatch.setattr(registry.settings, "payment_provider_mode", "off", raising=False)
    with pytest.raises(ProviderConfigurationError) as exc:
        await registry.payment_provider().create_payment(_req())
    assert exc.value.code == "payment_provider_off"


def test_registry_simulated_in_development(monkeypatch):
    monkeypatch.setattr(registry.settings, "environment", "development")
    monkeypatch.setattr(registry.settings, "payment_provider_mode", "simulated", raising=False)
    assert isinstance(registry.payment_provider(), sim_payment.SimulatedPaymentProvider)


@pytest.mark.parametrize("env", ["staging", "production"])
def test_registry_forbids_simulated_in_working_environments(monkeypatch, env):
    monkeypatch.setattr(registry.settings, "environment", env)
    monkeypatch.setattr(registry.settings, "payment_provider_mode", "simulated", raising=False)
    with pytest.raises(SimulatedProviderForbidden):
        registry.payment_provider()


def test_registry_rejects_invalid_mode(monkeypatch):
    monkeypatch.setattr(registry.settings, "payment_provider_mode", "demo", raising=False)
    with pytest.raises(ProviderConfigurationError) as exc:
        registry.payment_provider()
    assert exc.value.code == "invalid_provider_mode"


def test_health_report_covers_every_port(monkeypatch):
    for port in registry._PORTS:
        monkeypatch.setattr(registry.settings, f"{port}_provider_mode", "off", raising=False)
    report = registry.health_report()
    assert set(report) == set(registry._PORTS)
    assert all(v["mode"] == "off" for v in report.values())
