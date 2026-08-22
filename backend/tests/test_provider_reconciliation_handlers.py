from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest

from app.models.entities import PaymentStatus
from app.services import provider_reconciliation_handlers as handlers
from app.services import provider_reconciliation_service as ledger
from app.services.fns import receipt_verify as fns


class FakeDB:
    def __init__(self, receipt=None, *, objects: dict[str, object] | None = None):
        self.receipt = receipt
        self.objects = objects or {}
        self.flushes = 0

    async def get(self, _model, resource_id):
        if resource_id in self.objects:
            return self.objects[resource_id]
        return self.receipt

    async def flush(self):
        self.flushes += 1


def claim(resource_id: str = "receipt-1") -> ledger.ReconciliationClaim:
    return ledger.ReconciliationClaim(
        id="ledger-1",
        provider="fns",
        operation_type="receipt_verify",
        resource_type="receipt",
        resource_id=resource_id,
        provider_resource_id=None,
        generation=1,
        attempts=1,
    )


def yookassa_claim(*, attempts: int = 1) -> ledger.ReconciliationClaim:
    return ledger.ReconciliationClaim(
        id="ledger-yookassa-1",
        provider="yookassa",
        operation_type="payment_status",
        resource_type="payment",
        resource_id="payment-1",
        provider_resource_id="yk-payment-1",
        generation=2,
        attempts=attempts,
    )


def yookassa_objects():
    payment = SimpleNamespace(
        id="payment-1",
        project_id="project-1",
        status=PaymentStatus.processing,
        amount=100.0,
        yookassa_payment_id="yk-payment-1",
    )
    project = SimpleNamespace(id="project-1", customer_id="customer-1")
    return payment, project, FakeDB(objects={payment.id: payment, project.id: project})


def remote_snapshot(status: str) -> dict:
    return {
        "demo": False,
        "payment_id": "yk-payment-1",
        "status": status,
        "remote_amount": Decimal("100.00"),
        "remote_currency": "RUB",
        "metadata": {
            "kind": "project_payment",
            "project_id": "project-1",
            "payment_id": "payment-1",
            "user_id": "customer-1",
        },
        "cancellation_reason": None,
    }


@pytest.mark.asyncio
async def test_fns_pending_truth_defers_without_persisting_provider_payload(monkeypatch):
    receipt = SimpleNamespace(
        qr_raw="t=20260101T1200&s=100.00&fn=1&i=2&fp=3&n=1",
        verification_status=fns.VERIFICATION_PENDING,
        fns_verified=False,
    )
    db = FakeDB(receipt)
    captured = {}

    async def fake_verify(_parsed):
        return {
            "verification_status": fns.VERIFICATION_PENDING,
            "verified": False,
            "retryable": True,
            "provider_payload": {"Authorization": "must-not-persist"},
        }

    async def fake_retry(_db, _claim, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(fns, "verify_receipt", fake_verify)
    monkeypatch.setattr(ledger, "mark_retry", fake_retry)

    assert await handlers.reconcile_fns_receipt(db, claim(), worker_id="worker-a")
    assert receipt.verification_status == fns.VERIFICATION_PENDING
    assert receipt.fns_verified is False
    assert captured["error_code"] == "fns_verification_pending"
    assert "provider_payload" not in captured
    assert "must-not-persist" not in str(captured)


@pytest.mark.asyncio
async def test_fns_verified_truth_updates_domain_and_completes(monkeypatch):
    receipt = SimpleNamespace(
        qr_raw="t=20260101T1200&s=100.00&fn=1&i=2&fp=3&n=1",
        verification_status=fns.VERIFICATION_PENDING,
        fns_verified=False,
    )
    db = FakeDB(receipt)
    captured = {}

    async def fake_verify(_parsed):
        return {
            "verification_status": fns.VERIFIED_LIVE,
            "verified": True,
            "retryable": False,
            "provider_payload": {"receipt": {"total": 10000}},
        }

    async def fake_completed(_db, _claim, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(fns, "verify_receipt", fake_verify)
    monkeypatch.setattr(ledger, "mark_completed", fake_completed)

    assert await handlers.reconcile_fns_receipt(db, claim(), worker_id="worker-a")
    assert receipt.verification_status == fns.VERIFIED_LIVE
    assert receipt.fns_verified is True
    assert captured["provider_status"] == fns.VERIFIED_LIVE
    assert "provider_payload" not in captured


@pytest.mark.asyncio
async def test_fns_concurrent_final_domain_truth_short_circuits_provider(monkeypatch):
    receipt = SimpleNamespace(
        qr_raw="anything",
        verification_status=fns.VERIFIED_LIVE,
        fns_verified=True,
    )
    db = FakeDB(receipt)
    called = {"verify": 0, "completed": 0}

    async def unexpected_verify(_parsed):
        called["verify"] += 1
        raise AssertionError("provider should not be called for final domain truth")

    async def fake_completed(_db, _claim, **_kwargs):
        called["completed"] += 1
        return True

    monkeypatch.setattr(fns, "verify_receipt", unexpected_verify)
    monkeypatch.setattr(ledger, "mark_completed", fake_completed)

    assert await handlers.reconcile_fns_receipt(db, claim(), worker_id="worker-a")
    assert called == {"verify": 0, "completed": 1}


@pytest.mark.asyncio
async def test_yookassa_pending_is_non_exhaustible_authoritative_retry(monkeypatch):
    _payment, _project, db = yookassa_objects()
    captured = {}

    async def fake_load(_provider_id):
        return remote_snapshot("pending")

    async def fake_retry(_db, _claim, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(handlers.checkout, "load_provider_payment", fake_load)
    monkeypatch.setattr(ledger, "mark_retry", fake_retry)

    assert await handlers.reconcile_yookassa_payment(
        db,
        yookassa_claim(attempts=ledger.MAX_ATTEMPTS + 5),
        worker_id="worker-y",
    )
    assert captured["provider_status"] == "pending"
    assert captured["error_code"] == "yookassa_not_terminal"
    assert captured["exhaustible"] is False


@pytest.mark.asyncio
async def test_yookassa_succeeded_waiting_for_local_acceptance_stays_reconcilable(monkeypatch):
    _payment, _project, db = yookassa_objects()
    retry = {}
    confirm = {}

    async def fake_load(_provider_id):
        return remote_snapshot("succeeded")

    async def fake_confirm(_db, _payment_id, **kwargs):
        confirm.update(kwargs)
        return None

    async def fake_retry(_db, _claim, **kwargs):
        retry.update(kwargs)
        return True

    monkeypatch.setattr(handlers.checkout, "load_provider_payment", fake_load)
    monkeypatch.setattr(handlers.payment_service, "confirm_payment", fake_confirm)
    monkeypatch.setattr(ledger, "mark_retry", fake_retry)

    assert await handlers.reconcile_yookassa_payment(
        db,
        yookassa_claim(attempts=ledger.MAX_ATTEMPTS + 5),
        worker_id="worker-y",
    )
    assert confirm["machine_source"] == "reconciliation"
    assert confirm["allow_without_settlement"] is True
    assert confirm["allow_without_acceptance"] is False
    assert retry["error_code"] == "local_acceptance_pending"
    assert retry["provider_status"] == "succeeded"
    assert retry["exhaustible"] is False


@pytest.mark.asyncio
async def test_yookassa_succeeded_uses_existing_transition_and_completes(monkeypatch):
    payment, _project, db = yookassa_objects()
    confirm = {}
    completed = {}

    async def fake_load(_provider_id):
        return remote_snapshot("succeeded")

    async def fake_confirm(_db, payment_id, **kwargs):
        confirm.update(kwargs)
        assert payment_id == payment.id
        return payment

    async def fake_completed(_db, _claim, **kwargs):
        completed.update(kwargs)
        return True

    monkeypatch.setattr(handlers.checkout, "load_provider_payment", fake_load)
    monkeypatch.setattr(handlers.payment_service, "confirm_payment", fake_confirm)
    monkeypatch.setattr(ledger, "mark_completed", fake_completed)

    assert await handlers.reconcile_yookassa_payment(db, yookassa_claim(), worker_id="worker-y")
    assert confirm["machine_source"] == "reconciliation"
    assert confirm["commit"] is False
    assert completed["provider_status"] == "succeeded"


@pytest.mark.asyncio
async def test_yookassa_canceled_preserves_reconciliation_provenance(monkeypatch):
    _payment, _project, db = yookassa_objects()
    reversal_call = {}
    completed = {}

    async def fake_load(_provider_id):
        return remote_snapshot("canceled")

    async def fake_cancel(_db, **kwargs):
        reversal_call.update(kwargs)
        return SimpleNamespace(handled=True, reason=None)

    async def fake_completed(_db, _claim, **kwargs):
        completed.update(kwargs)
        return True

    monkeypatch.setattr(handlers.checkout, "load_provider_payment", fake_load)
    monkeypatch.setattr(handlers.reversal, "apply_provider_cancellation", fake_cancel)
    monkeypatch.setattr(ledger, "mark_completed", fake_completed)

    assert await handlers.reconcile_yookassa_payment(db, yookassa_claim(), worker_id="worker-y")
    assert reversal_call["source"] == "reconciliation"
    assert reversal_call["commit"] is False
    assert reversal_call["amount"] == 100.0
    assert reversal_call["currency"] == "RUB"
    assert completed["provider_status"] == "canceled"


@pytest.mark.asyncio
async def test_yookassa_auth_rejection_is_operator_visible_unavailable(monkeypatch):
    _payment, _project, db = yookassa_objects()
    terminal = {}

    async def fake_load(_provider_id):
        request = httpx.Request("GET", "https://api.yookassa.ru/v3/payments/redacted")
        response = httpx.Response(401, request=request)
        raise httpx.HTTPStatusError("auth rejected", request=request, response=response)

    async def fake_terminal(_db, _claim, **kwargs):
        terminal.update(kwargs)
        return True

    monkeypatch.setattr(handlers.checkout, "load_provider_payment", fake_load)
    monkeypatch.setattr(ledger, "mark_terminal", fake_terminal)

    assert await handlers.reconcile_yookassa_payment(db, yookassa_claim(), worker_id="worker-y")
    assert terminal["error_code"] == "yookassa_credentials_rejected"
    assert terminal["unavailable"] is True
    assert "redacted" not in terminal.get("error_code", "")
