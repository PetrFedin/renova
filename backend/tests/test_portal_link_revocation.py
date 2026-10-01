"""INB-04: реестр портал-ссылок и отзыв."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import Project, User, UserRole
from app.services import portal_link_service as links


async def _seed(db):
    customer = User(id="cu-pl", phone="+79990080001", role=UserRole.customer)
    contractor = User(id="ct-pl", phone="+79990080002", role=UserRole.contractor)
    other = User(id="ot-pl", phone="+79990080003", role=UserRole.contractor)
    p = Project(id="pr-pl", name="P", renovation_type="cosmetic", customer_id=customer.id,
                contractor_id=contractor.id, budget_planned=1, budget_spent=0)
    db.add_all([customer, contractor, other, p])
    await db.commit()
    return customer, contractor, other


async def _client(db, actor=None):
    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    if actor is not None:
        async def _user():
            return actor
        app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_issued_link_is_registered_and_revocable(db):
    customer, _, _ = await _seed(db)
    client = await _client(db, customer)
    try:
        r = await client.post("/api/v1/projects/pr-pl/portal-link", json={})
        assert r.status_code == 200
        body = r.json()
        assert body["id"]
        ok = await client.post("/api/v1/auth/portal/session", json={"token": body["token"]})
        assert ok.status_code == 200
        portal_jwt = ok.json()["access_token"]

        listed = (await client.get("/api/v1/projects/pr-pl/portal-links")).json()["items"]
        assert [i["id"] for i in listed] == [body["id"]]

        assert (await client.delete(f"/api/v1/projects/pr-pl/portal-links/{body['id']}")).status_code == 200
        assert (await client.get("/api/v1/projects/pr-pl/portal-links")).json()["items"] == []

        again = await client.post("/api/v1/auth/portal/session", json={"token": body["token"]})
        assert again.status_code == 401 and again.json()["detail"] == "portal_link_revoked"
    finally:
        app.dependency_overrides.clear()

    # уже выданный portal-JWT тоже перестаёт работать
    anon = await _client(db)
    try:
        r = await anon.get("/api/v1/portal/projects/pr-pl/snapshot", headers={"Authorization": f"Bearer {portal_jwt}"})
        assert r.status_code == 401 and r.json()["detail"] == "portal_link_revoked"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_contractor_revokes_only_own_links_customer_any(db):
    customer, contractor, other = await _seed(db)
    own, _ = await links.issue_link(db, project_id="pr-pl", user_id=customer.id, issued_by=contractor.id, scopes=["read"])
    cust_link, _ = await links.issue_link(db, project_id="pr-pl", user_id=customer.id, issued_by=customer.id, scopes=["read"])

    c = await _client(db, contractor)
    try:
        assert [i["id"] for i in (await c.get("/api/v1/projects/pr-pl/portal-links")).json()["items"]] == [own.id]
        assert (await c.delete(f"/api/v1/projects/pr-pl/portal-links/{cust_link.id}")).status_code == 403
        assert (await c.delete(f"/api/v1/projects/pr-pl/portal-links/{own.id}")).status_code == 200
    finally:
        app.dependency_overrides.clear()

    o = await _client(db, other)
    try:
        assert (await o.delete(f"/api/v1/projects/pr-pl/portal-links/{cust_link.id}")).status_code in (403, 404)
    finally:
        app.dependency_overrides.clear()

    cu = await _client(db, customer)
    try:
        assert (await cu.delete(f"/api/v1/projects/pr-pl/portal-links/{cust_link.id}")).status_code == 200
        assert (await cu.delete("/api/v1/projects/pr-pl/portal-links/nope")).status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_legacy_token_without_jti_still_exchanges_and_deleted_user_rejected(db):
    from app.services import portal_token_service as tok
    from datetime import datetime

    customer, _, _ = await _seed(db)
    legacy = tok.create_portal_token(project_id="pr-pl", user_id=customer.id)
    assert tok.verify_portal_token(legacy)["jti"] is None
    client = await _client(db)
    try:
        assert (await client.post("/api/v1/auth/portal/session", json={"token": legacy})).status_code == 200
        customer.deleted_at = datetime(2026, 1, 1)
        await db.commit()
        assert (await client.post("/api/v1/auth/portal/session", json={"token": legacy})).status_code == 401
    finally:
        app.dependency_overrides.clear()
