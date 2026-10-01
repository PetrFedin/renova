"""MNY-029 / APIA-008: статус ФНС не равен доказанному владению ИНН; провайдер за флагом."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.entities import User, UserRole
from app.services import npd_verification as npd_own


async def _call(db, actor, method, url, **kw):
    await db.refresh(actor)

    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, url, **kw)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def fns_says_npd(monkeypatch):
    async def fake(inn, request_date=None):
        return {"inn": inn, "request_date": "2026-01-01", "is_npd": True, "verified_live": True, "message": "ok"}

    monkeypatch.setattr("app.api.v1.fns.check_taxpayer_npd_status", fake)


@pytest.mark.asyncio
async def test_default_provider_is_honest_unverified_and_legacy_flag_kept(db, fns_says_npd):
    user = User(id="npd-u1", phone="+79990011001", role=UserRole.contractor)
    db.add(user)
    await db.commit()
    r = await _call(db, user, "POST", "/api/v1/fns/verify-me", json={"inn": "123456789012"})
    body = r.json()
    assert r.status_code == 200
    assert body["ownership_status"] == "unverified" and body["ownership_provider"] == "none"
    assert body["badge"] == "verified"  # прежнее поведение без флага
    await db.refresh(user)
    assert user.npd_verified is True


@pytest.mark.asyncio
async def test_enforced_mode_never_marks_verified_without_ownership(db, fns_says_npd, monkeypatch):
    monkeypatch.setattr(settings, "npd_ownership_enforced", True)
    for provider, status in (("none", "unverified"), ("manual", "pending_manual"), ("garbage", "unverified")):
        monkeypatch.setattr(settings, "npd_ownership_provider", provider)
        user = User(id=f"npd-{provider}", phone=f"+7999002{abs(hash(provider)) % 10000:04d}", role=UserRole.contractor)
        db.add(user)
        await db.commit()
        r = await _call(db, user, "POST", "/api/v1/fns/verify-me", json={"inn": "123456789012"})
        assert r.status_code == 200
        assert r.json()["ownership_status"] == status
        assert r.json()["badge"] != "verified"
        await db.refresh(user)
        assert user.npd_verified is False


@pytest.mark.asyncio
async def test_proven_provider_sets_flag_and_failing_provider_is_unverified(monkeypatch):
    monkeypatch.setattr(settings, "npd_ownership_enforced", True)

    class Proven:
        name = "proven"

        async def verify(self, *, user_id, inn):
            return npd_own.OwnershipDecision(npd_own.VERIFIED, self.name, "ok")

    class Broken:
        name = "broken"

        async def verify(self, *, user_id, inn):
            raise RuntimeError("provider down")

    monkeypatch.setitem(npd_own.PROVIDERS, "proven", Proven())
    monkeypatch.setitem(npd_own.PROVIDERS, "broken", Broken())
    monkeypatch.setattr(settings, "npd_ownership_provider", "proven")
    assert await npd_own.npd_flag_for_inn(user_id="u", inn="1" * 12, fns_is_npd=True) is True
    assert await npd_own.npd_flag_for_inn(user_id="u", inn="1" * 12, fns_is_npd=False) is False
    monkeypatch.setattr(settings, "npd_ownership_provider", "broken")
    assert await npd_own.npd_flag_for_inn(user_id="u", inn="1" * 12, fns_is_npd=True) is False
