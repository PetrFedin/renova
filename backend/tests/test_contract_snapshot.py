"""Снимок подписанного договора (DOC-009) и ручка «Создать договор» (DOC-…/no_contract)."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import EstimateLine, LineType, Project, User, UserRole
from app.models.project_documents import DocumentSignature, DocumentVersion
from app.services import project_document_service as docs


async def _seed(db, *, draft=True):
    contractor = User(id="ct-sn", phone="+79990007001", role=UserRole.contractor)
    customer = User(id="cu-sn", phone="+79990007002", role=UserRole.customer)
    outsider = User(id="ou-sn", phone="+79990007003", role=UserRole.customer)
    project = Project(
        id="p-sn", name="P", renovation_type="cosmetic", customer_id=customer.id,
        contractor_id=contractor.id, budget_planned=1, budget_spent=0,
    )
    line = EstimateLine(
        id="l-sn", project_id="p-sn", line_type=LineType.work, name="Стяжка", unit="m2",
        quantity_planned=10, unit_price=100,
    )
    db.add_all([contractor, customer, outsider, project, line])
    await db.commit()
    doc_id = None
    if draft:
        doc_id = (await docs.ensure_contract_draft(db, project_id="p-sn", created_by=customer.id))["document_id"]
        await db.commit()
    return contractor, customer, outsider, doc_id


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


def _sign(doc_id):
    return f"/api/v1/projects/p-sn/documents/{doc_id}/sign"


@pytest.mark.asyncio
async def test_snapshot_survives_estimate_edit_and_hash_matches_pdf(db):
    contractor, customer, _, doc_id = await _seed(db)
    async with await _client(db, customer) as c:
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
        before = await c.get("/api/v1/projects/p-sn/contract.pdf")
    line = await db.get(EstimateLine, "l-sn")
    line.unit_price = 999_999
    await db.commit()
    async with await _client(db, contractor) as c:
        after = await c.get("/api/v1/projects/p-sn/contract.pdf")
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
    assert before.status_code == after.status_code == 200
    assert before.headers["x-content-sha256"] == after.headers["x-content-sha256"]
    sigs = list((await db.execute(select(DocumentSignature))).scalars().all())
    assert len(sigs) == 2
    assert all(s.content_hash for s in sigs)
    assert {s.content_hash for s in sigs} == {before.headers["x-content-sha256"]}
    version = (await db.execute(select(DocumentVersion))).scalars().first()
    assert version.checksum_sha256 == sigs[0].content_hash
    assert '"works_total":1000.0' in version.content_snapshot


@pytest.mark.asyncio
async def test_unsigned_contract_follows_estimate(db):
    _, customer, _, _ = await _seed(db)
    async with await _client(db, customer) as c:
        first = await c.get("/api/v1/projects/p-sn/contract.pdf")
    line = await db.get(EstimateLine, "l-sn")
    line.unit_price = 200
    await db.commit()
    async with await _client(db, customer) as c:
        second = await c.get("/api/v1/projects/p-sn/contract.pdf")
    assert first.headers["x-content-sha256"] != second.headers["x-content-sha256"]


@pytest.mark.asyncio
async def test_wrong_content_hash_rejected(db):
    _, customer, _, doc_id = await _seed(db)
    async with await _client(db, customer) as c:
        r = await c.post(_sign(doc_id), json={"provider": "in_app", "content_hash": "0" * 64})
    assert r.status_code == 400 and "content_hash_mismatch" in r.text


@pytest.mark.asyncio
async def test_create_contract_idempotent_and_party_only(db):
    contractor, customer, outsider, _ = await _seed(db, draft=False)
    async with await _client(db, outsider) as c:
        assert (await c.post("/api/v1/projects/p-sn/contract")).status_code == 403
    async with await _client(db, contractor) as c:
        first = await c.post("/api/v1/projects/p-sn/contract")
    async with await _client(db, customer) as c:
        second = await c.post("/api/v1/projects/p-sn/contract")
    assert first.status_code == second.status_code == 200
    assert first.json()["created"] is True and second.json()["created"] is False
    assert first.json()["document_id"] == second.json()["document_id"]
    assert second.json()["gate"]["reason"] == "awaiting_signatures"


@pytest.mark.asyncio
async def test_create_contract_needs_estimate(db):
    contractor, customer, _, _ = await _seed(db, draft=False)
    await db.delete(await db.get(EstimateLine, "l-sn"))
    await db.commit()
    async with await _client(db, customer) as c:
        r = await c.post("/api/v1/projects/p-sn/contract")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "estimate_not_ready"
