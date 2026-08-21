from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import provider_reconciliation_handlers as handlers
from app.services import provider_reconciliation_service as ledger
from app.services.fns import receipt_verify as fns


class FakeDB:
    def __init__(self, receipt):
        self.receipt = receipt
        self.flushes = 0

    async def get(self, _model, _resource_id):
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
