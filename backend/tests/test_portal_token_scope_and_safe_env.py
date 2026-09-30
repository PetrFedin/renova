"""Portal JWT scope (DOC-001/002, APIB-001) + fail-closed environment (APIB-002)."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.admin_access import admin_access_state
from app.api.deps import get_current_user
from app.core.config import Settings, settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.entities import Project, ProjectViewer, User, UserRole
from app.services import portal_token_service as portal_tok


async def _seed(db):
    customer = User(id="cu-ps", phone="+79990006001", role=UserRole.customer)
    contractor = User(id="ct-ps", phone="+79990006002", role=UserRole.contractor)
    pa = Project(id="pa-ps", name="A", renovation_type="cosmetic", customer_id=customer.id,
                 contractor_id=contractor.id, budget_planned=1, budget_spent=0)
    pb = Project(id="pb-ps", name="B", renovation_type="cosmetic", customer_id=customer.id,
                 contractor_id=contractor.id, budget_planned=1, budget_spent=0)
    db.add_all([customer, contractor, pa, pb])
    await db.commit()
    return customer, contractor, pa, pb


async def _client(db, actor=None):
    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    if actor is not None:
        async def _user():
            return actor
        app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _portal_bearer(client, project_id, user_id, scopes):
    link = portal_tok.create_portal_token(project_id=project_id, user_id=user_id, scopes=scopes)
    r = await client.post("/api/v1/auth/portal/session", json={"token": link})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_portal_jwt_only_valid_for_link_project_and_actions(db):
    customer, _, pa, pb = await _seed(db)
    client = await _client(db)
    try:
        h = await _portal_bearer(client, pa.id, customer.id, ["read"])
        # allowed: snapshot of the link's project
        ok = await client.get(f"/api/v1/portal/projects/{pa.id}/snapshot", headers=h)
        assert ok.status_code == 200, ok.text
        # foreign project
        assert (await client.get(f"/api/v1/portal/projects/{pb.id}/snapshot", headers=h)).status_code == 403
        # ordinary endpoints are closed for the portal token
        assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 403
        assert (await client.post(f"/api/v1/projects/{pa.id}/portal-link",
                                  json={"allow_pay": True}, headers=h)).status_code == 403
        assert (await client.get(f"/api/v1/projects/{pa.id}", headers=h)).status_code == 403
        # pay action requires the pay scope
        r = await client.post(f"/api/v1/projects/{pa.id}/payments/x/yookassa-checkout", headers=h)
        assert r.status_code == 403 and "pay_scope_required" in r.text
    finally:
        await client.aclose()
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_regular_access_token_unaffected(db):
    customer, _, pa, _ = await _seed(db)
    client = await _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(customer.id)}"}
        assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 200
    finally:
        await client.aclose()
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_contractor_cannot_issue_write_scope_link_for_customer(db):
    customer, contractor, pa, _ = await _seed(db)
    client = await _client(db, contractor)
    try:
        for body in ({"allow_accept_stage": True}, {"allow_pay": True},
                     {"allow_accept_stage": True, "allow_pay": True}):
            r = await client.post(f"/api/v1/projects/{pa.id}/portal-link", json=body)
            assert r.status_code == 403, r.text
        r = await client.post(f"/api/v1/projects/{pa.id}/portal-link", json={})
        assert r.status_code == 200
        assert portal_tok.verify_portal_token(r.json()["token"])["scopes"] == ["read"]
    finally:
        await client.aclose()
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_customer_can_issue_write_scope_link(db):
    customer, _, pa, _ = await _seed(db)
    client = await _client(db, customer)
    try:
        r = await client.post(f"/api/v1/projects/{pa.id}/portal-link",
                              json={"allow_accept_stage": True, "allow_pay": True})
        assert r.status_code == 200, r.text
        assert set(portal_tok.verify_portal_token(r.json()["token"])["scopes"]) >= {"accept_stage", "pay"}
    finally:
        await client.aclose()
        app.dependency_overrides.clear()


def test_unset_environment_defaults_to_production(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    s = Settings(_env_file=None)
    assert s.normalized_environment == "production"
    assert s.allow_header_user_id is False


@pytest.mark.asyncio
async def test_implicit_environment_closes_header_login_and_admin(db, monkeypatch):
    customer, contractor, _, _ = await _seed(db)
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "auth_allow_header_user_id", None)
    monkeypatch.setattr(settings, "admin_user_ids", "")
    client = await _client(db)
    try:
        r = await client.get("/api/v1/auth/me", headers={"X-User-Id": customer.id})
        assert r.status_code == 401
    finally:
        await client.aclose()
        app.dependency_overrides.clear()
    allowed, reason = admin_access_state(contractor)
    assert not allowed and reason == "admin_access_not_configured"


def test_explicit_development_keeps_local_behaviour(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "auth_allow_header_user_id", None)
    assert settings.allow_header_user_id is True
