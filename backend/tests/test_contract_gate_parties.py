"""Гейт начала работ: основной договор подписан ОБЕИМИ сторонами (JRN-002, DOC-003..008).

По образцу test_floor_plan_acl_and_replay: HTTP-клиент поверх общей сессии БД
с подменой get_current_user.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import Project, User, UserRole
from app.models.project_documents import DocumentSignature, DocumentType
from app.services import project_document_service as docs


async def _seed(db, *, with_contractor=True):
    contractor = User(id="ct-cg", phone="+79990006001", role=UserRole.contractor)
    customer = User(id="cu-cg", phone="+79990006002", role=UserRole.customer)
    project = Project(
        id="p-cg", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id if with_contractor else None,
        budget_planned=1, budget_spent=0,
    )
    db.add_all([contractor, customer, project])
    await db.commit()
    created = await docs.ensure_contract_draft(db, project_id=project.id, created_by=customer.id)
    await db.commit()
    return contractor, customer, created["document_id"]


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _sign(doc_id):
    return f"/api/v1/projects/p-cg/documents/{doc_id}/sign"


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


async def _gate(db):
    return await docs.project_contract_gate(db, "p-cg")


@pytest.mark.asyncio
async def test_one_party_does_not_open_gate_two_do(db):
    contractor, customer, doc_id = await _seed(db)
    async with await _client(db, contractor) as c:
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
    gate = await _gate(db)
    assert gate["ok"] is False and gate["awaiting_parties"] == ["customer"]
    async with await _client(db, customer) as c:
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
    assert (await _gate(db))["ok"] is True


@pytest.mark.asyncio
async def test_outsider_and_wrong_party_cannot_sign(db):
    contractor, customer, doc_id = await _seed(db)
    outsider = User(id="ou-cg", phone="+79990006003", role=UserRole.contractor)
    db.add(outsider)
    await db.commit()
    async with await _client(db, outsider) as c:
        r = await c.post(_sign(doc_id), json={"provider": "in_app"})
        assert r.status_code in (403, 404)
    assert (await db.execute(select(DocumentSignature))).scalars().first() is None


@pytest.mark.asyncio
async def test_post_and_upload_contract_type_rejected_and_do_not_open_gate(db):
    contractor, customer, doc_id = await _seed(db)
    async with await _client(db, customer) as c:
        r = await c.post(
            "/api/v1/projects/p-cg/documents",
            json={"title": "Договор", "document_type": "contract", "href": "https://evil.example/x.pdf"},
        )
        assert r.status_code == 400 and r.json()["detail"]["code"] == "document_type_reserved"
        r = await c.post(
            "/api/v1/projects/p-cg/documents/upload",
            data={"document_type": "contract"},
            files={"file": ("d.pdf", b"%PDF-1.4 x", "application/pdf")},
        )
        assert r.status_code == 400
    assert (await _gate(db))["document_id"] == doc_id


@pytest.mark.asyncio
async def test_new_version_after_signature_blocked(db):
    contractor, customer, doc_id = await _seed(db)
    async with await _client(db, customer) as c:
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
        r = await c.post(
            f"/api/v1/projects/p-cg/documents/{doc_id}/versions",
            json={"href": "https://evil.example/other.pdf"},
        )
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "signed_document_version_locked"


@pytest.mark.asyncio
async def test_main_contract_cannot_be_deleted_or_archived(db):
    contractor, customer, doc_id = await _seed(db)
    async with await _client(db, customer) as c:
        assert (await c.delete(f"/api/v1/projects/p-cg/documents/{doc_id}")).status_code == 409
        assert (await c.post(f"/api/v1/projects/p-cg/documents/{doc_id}/archive")).status_code == 409
    gate = await _gate(db)
    assert gate["reason"] == "awaiting_signatures"


@pytest.mark.asyncio
async def test_self_managed_customer_signs_alone(db):
    _, customer, doc_id = await _seed(db, with_contractor=False)
    async with await _client(db, customer) as c:
        assert (await c.post(_sign(doc_id), json={"provider": "in_app"})).status_code == 200
    assert (await _gate(db))["ok"] is True


@pytest.mark.asyncio
async def test_change_order_document_does_not_block_or_open_gate(db):
    from app.models.entities import ChangeOrder

    contractor = User(id="ct-cg", phone="+79990006001", role=UserRole.contractor)
    customer = User(id="cu-cg", phone="+79990006002", role=UserRole.customer)
    project = Project(id="p-cg", name="P", renovation_type="cosmetic", customer_id="cu-cg",
                      contractor_id="ct-cg", budget_planned=1, budget_spent=0)
    order = ChangeOrder(id="co-cg", project_id="p-cg", title="Доп", amount=10, created_by="ct-cg")
    db.add_all([contractor, customer, project, order])
    await db.commit()
    addendum = await docs.create_document(
        db, project_id="p-cg", created_by="ct-cg", title="Доп. работы",
        document_type=DocumentType.addendum.value, change_order_id="co-cg", href="/x.pdf",
    )
    await db.commit()
    created = await docs.ensure_contract_draft(db, project_id="p-cg", created_by="cu-cg")
    assert created["created"] is True and created["document_id"] != addendum.id
    for user in (customer, contractor):
        await docs.sign_document(db, addendum, signer_user_id=user.id, signer_role=user.role.value)
    assert (await _gate(db))["ok"] is False
