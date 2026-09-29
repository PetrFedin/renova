"""A5: simulated fiscal-receipt and NPD providers — contract + wiring into legacy FNS services."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.services.fns import receipt_verify, status_npd
from app.services.providers import base, registry
from app.services.providers.simulated.fiscal import SimulatedFiscalReceiptProvider
from app.services.providers.simulated.npd import SimulatedNpdStatusProvider


@pytest.fixture(autouse=True)
def _reset():
    registry.reset()
    yield
    registry.reset()


def _q(fp: str, amount: str = "1500.00") -> base.ReceiptQuery:
    return base.ReceiptQuery(fn="9280440300123456", fd="12345", fp=fp, money=base.Money(Decimal(amount)), issued_at=datetime.now(timezone.utc))


class TestFiscalContract:
    def test_is_port(self):
        assert isinstance(SimulatedFiscalReceiptProvider(), base.FiscalReceiptProvider)

    @pytest.mark.parametrize("fp,verdict", [
        ("1234567890", base.ReceiptVerdict.VALID),
        ("1234569999", base.ReceiptVerdict.NOT_FOUND),
        ("1234568888", base.ReceiptVerdict.AMOUNT_MISMATCH),
        ("1234567777", base.ReceiptVerdict.UNAVAILABLE),
    ])
    async def test_deterministic_verdicts(self, fp, verdict):
        r = await SimulatedFiscalReceiptProvider().verify(_q(fp))
        assert r.verdict is verdict

    async def test_valid_echoes_amount_and_seller(self):
        r = await SimulatedFiscalReceiptProvider().verify(_q("1", "999.99"))
        assert r.provider_amount == base.Money(Decimal("999.99")) and r.seller_inn

    async def test_mismatch_amount_differs(self):
        r = await SimulatedFiscalReceiptProvider().verify(_q("8888", "1000.00"))
        assert r.provider_amount.amount != Decimal("1000.00")


class TestNpdContract:
    def test_is_port(self):
        assert isinstance(SimulatedNpdStatusProvider(), base.SelfEmployedStatusProvider)

    @pytest.mark.parametrize("inn,status", [
        ("500100732259", base.NpdStatus.ACTIVE),
        ("500100732200", base.NpdStatus.INACTIVE),
        ("500100732299", base.NpdStatus.UNKNOWN),
    ])
    async def test_deterministic(self, inn, status):
        r = await SimulatedNpdStatusProvider().check(inn, datetime.now(timezone.utc))
        assert r.status is status and r.inn == inn


# --- wiring into legacy services (behaviour changes ONLY when mode == simulated) ---

def _parsed(fp: str, amount: float = 1500.0) -> dict:
    return {"valid": True, "fn": "9280440300123456", "fd": "12345", "fp": fp, "amount": amount, "t": "2026-09-01T12:00:00"}


async def test_receipt_off_mode_keeps_legacy_pending(monkeypatch):
    monkeypatch.setattr(receipt_verify.settings, "fiscal_receipt_provider_mode", "off", raising=False)
    monkeypatch.setattr(receipt_verify.settings, "fns_receipt_login", None, raising=False)
    r = await receipt_verify.verify_receipt(_parsed("1"))
    assert r["status"] == receipt_verify.VERIFICATION_PENDING


@pytest.mark.parametrize("fp,status", [
    ("1", receipt_verify.VERIFIED_LIVE),
    ("9999", receipt_verify.INVALID),
    ("8888", receipt_verify.INVALID),
    ("7777", receipt_verify.VERIFICATION_PENDING),
])
async def test_receipt_simulated_mode_maps_verdicts(monkeypatch, fp, status):
    monkeypatch.setattr(receipt_verify.settings, "environment", "development")
    monkeypatch.setattr(receipt_verify.settings, "fiscal_receipt_provider_mode", "simulated", raising=False)
    r = await receipt_verify.verify_receipt(_parsed(fp))
    assert r["status"] == status
    assert r["provider_payload"]["provider"] == "simulated_fiscal_receipt"
    if status == receipt_verify.VERIFIED_LIVE:
        assert r["verified"] is True


@pytest.mark.parametrize("env", ["staging", "production"])
async def test_receipt_simulated_forbidden_in_working_envs(monkeypatch, env):
    monkeypatch.setattr(receipt_verify.settings, "environment", env)
    monkeypatch.setattr(receipt_verify.settings, "fiscal_receipt_provider_mode", "simulated", raising=False)
    from app.services.providers.errors import SimulatedProviderForbidden
    with pytest.raises(SimulatedProviderForbidden):
        await receipt_verify.verify_receipt(_parsed("1"))


async def test_npd_off_mode_keeps_legacy_unavailable(monkeypatch):
    monkeypatch.setattr(status_npd.settings, "npd_status_provider_mode", "off", raising=False)
    monkeypatch.setattr(status_npd.settings, "fns_npd_status_url", None, raising=False)
    with pytest.raises(status_npd.FnsNpdUnavailable):
        await status_npd.check_taxpayer_npd_status("500100732259", date(2026, 9, 1))


async def test_npd_simulated_mode(monkeypatch):
    monkeypatch.setattr(status_npd.settings, "environment", "development")
    monkeypatch.setattr(status_npd.settings, "npd_status_provider_mode", "simulated", raising=False)
    r = await status_npd.check_taxpayer_npd_status("500100732259", date(2026, 9, 1))
    assert r["is_npd"] is True and r["verified_live"] is False and r["provider"] == "simulated_npd_status"
    r = await status_npd.check_taxpayer_npd_status("500100732200", date(2026, 9, 1))
    assert r["is_npd"] is False
    with pytest.raises(status_npd.FnsNpdUnavailable):
        await status_npd.check_taxpayer_npd_status("500100732299", date(2026, 9, 1))
