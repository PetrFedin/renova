"""DOC-015: гость портала читает документ по токену до подписи."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db
from app.main import app
from app.models.entities import Project, User, UserRole
from app.services import portal_link_service as links
from app.services import project_document_service as docs
from app.services import storage_service as storage_svc


async def _seed(db):
    customer = User(id="cu-dc", phone="+79990090001", role=UserRole.customer)
    contractor = User(id="ct-dc", phone="+79990090002", role=UserRole.contractor)
    pa = Project(id="pa-dc", name="A", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0)
    pb = Project(id="pb-dc", name="B", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0)
    db.add_all([customer, contractor, pa, pb])
    await db.commit()
    doc = await docs.create_document(db, project_id="pa-dc", created_by=contractor.id, title="Договор")
    await docs.add_version(db, doc, created_by=contractor.id, storage_key="documents/pa-dc/d.pdf", mime_type="application/pdf")
    await db.commit()
    return customer, doc


async def _bearer(client, db, project_id, user_id):
    link, token = await links.issue_link(db, project_id=project_id, user_id=user_id, issued_by=user_id, scopes=["read"])
    r = await client.post("/api/v1/auth/portal/session", json={"token": token})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_portal_read_scope_downloads_document_content(db, monkeypatch):
    customer, doc = await _seed(db)

    async def _db():
        yield db

    async def _read(key):
        return b"%PDF-1.4 test"

    app.dependency_overrides[get_db] = _db
    monkeypatch.setattr(storage_svc, "presigned_url", lambda key, expires=3600: None)
    monkeypatch.setattr(storage_svc, "read_image", _read)
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        headers = await _bearer(client, db, "pa-dc", customer.id)
        r = await client.get(f"/api/v1/portal/projects/pa-dc/documents/{doc.id}/content", headers=headers)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
        # документ чужого проекта не отдаётся тем же токеном
        other = await client.get(f"/api/v1/portal/projects/pb-dc/documents/{doc.id}/content", headers=headers)
        assert other.status_code == 403
        missing = await client.get("/api/v1/portal/projects/pa-dc/documents/nope/content", headers=headers)
        assert missing.status_code == 404
    finally:
        app.dependency_overrides.clear()
