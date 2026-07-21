"""FNS receipt verify honesty + URL builder."""
import pytest

from app.services.fns.receipt_verify import (
    build_receipt_check_url,
    fns_receipt_health,
    parse_receipt_qr,
    verify_receipt,
)


def test_parse_receipt_qr():
    p = parse_receipt_qr("t=20260719T1200&s=1500.00&fn=123&i=456&fp=789")
    assert p["fn"] == "123"
    assert p["fd"] == "456"
    assert p["amount"] == 1500.0


def test_build_url_contains_fn():
    url = build_receipt_check_url("111", "222", "333", 100.0)
    assert "111" in url and "222" in url and "333" in url


@pytest.mark.asyncio
async def test_verify_staging_no_demo(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "environment", "staging")
    monkeypatch.setattr(config.settings, "fns_receipt_login", None)
    monkeypatch.setattr(config.settings, "fns_receipt_password", None)

    async def boom(*_a, **_k):
        raise RuntimeError("offline")

    monkeypatch.setattr("httpx.AsyncClient.get", boom)
    # patch client context - easier: make get raise via custom client
    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k):
            raise RuntimeError("offline")

    monkeypatch.setattr("httpx.AsyncClient", FakeClient)
    out = await verify_receipt({"fn": "1", "fd": "2", "fp": "3", "amount": 10})
    assert out["verified"] is False
    assert out["mode"] == "offline"


def test_health_hint_when_no_auth(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "fns_receipt_login", None)
    monkeypatch.setattr(config.settings, "fns_receipt_password", None)
    h = fns_receipt_health()
    assert h["receipt_auth_configured"] is False
    assert h["hint"]
