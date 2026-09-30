"""Owner decision: a contractor's self-claim is a request the customer confirms."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    AppNotification, ContractorProfile, Project, Stage, StageStatus, User, UserRole,
)
from app.models.project_assignment_requests import ProjectAssignmentRequest
from app.models.project_documents import DocumentSignature, DocumentVersion, ProjectDocument
from app.services import project_assignment_service as assignment_service


async def _seed(db, monkeypatch=None):
    if monkeypatch is not None:
        monkeypatch.setattr(assignment_service.settings, "contractor_free_project_limit", 99)
    users = {
        "cust": User(id="cu-ar", phone="+79990007001", role=UserRole.customer),
        "other": User(id="cu2-ar", phone="+79990007002", role=UserRole.customer),
        "c1": User(id="c1-ar", phone="+79990007003", role=UserRole.contractor),
        "c2": User(id="c2-ar", phone="+79990007004", role=UserRole.contractor),
    }
    project = Project(
        id="p-ar", name="Кв", renovation_type="cosmetic", customer_id="cu-ar",
        budget_planned=1, budget_spent=0,
    )
    db.add_all([*users.values(), project])
    await db.commit()
    return users, project


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


async def _fresh(db, model, pk):
    obj = await db.get(model, pk)
    await db.refresh(obj)
    return obj


async def _lead(db, pid="p-ar"):
    return await db.scalar(select(Project.contractor_id).where(Project.id == pid))


async def _claim(db, actor):
    r = await _call(db, actor, "POST", "/api/v1/projects/p-ar/assign")
    assert r.status_code == 202, r.text
    return r.json()["request"]["id"]


@pytest.mark.asyncio
async def test_self_claim_does_not_assign_and_notifies_customer(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    r = await _call(db, u["c1"], "POST", "/api/v1/projects/p-ar/assign")
    assert r.status_code == 202
    assert r.json()["status"] == "pending_customer_confirmation"
    assert await _lead(db) is None
    note = await db.scalar(select(AppNotification).where(AppNotification.user_id == "cu-ar"))
    assert note is not None and note.link_path.startswith("/(customer)/(tabs)/profile")
    assert "(tabs)/home" not in note.link_path


@pytest.mark.asyncio
async def test_repeat_claim_is_idempotent(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    first = await _claim(db, u["c1"])
    second = await _claim(db, u["c1"])
    assert first == second
    assert await db.scalar(select(func.count()).select_from(ProjectAssignmentRequest)) == 1
    notes = await db.scalar(
        select(func.count()).select_from(AppNotification).where(AppNotification.user_id == "cu-ar")
    )
    assert notes == 1


@pytest.mark.asyncio
async def test_customer_accepts_and_others_are_closed(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    r1 = await _claim(db, u["c1"])
    r2 = await _claim(db, u["c2"])
    ok = await _call(db, u["cust"], "POST", f"/api/v1/projects/p-ar/assignment-requests/{r1}/accept")
    assert ok.status_code == 200, ok.text
    assert await _lead(db) == "c1-ar"
    assert (await _fresh(db, ProjectAssignmentRequest, r1)).status == "accepted"
    assert (await _fresh(db, ProjectAssignmentRequest, r2)).status == "superseded"
    late = await _call(db, u["cust"], "POST", f"/api/v1/projects/p-ar/assignment-requests/{r2}/accept")
    assert late.status_code == 409 and late.json()["detail"]["code"] == "request_not_pending"
    again = await _call(db, u["cust"], "POST", f"/api/v1/projects/p-ar/assignment-requests/{r1}/accept")
    assert again.status_code == 200  # replay of the same decision


@pytest.mark.asyncio
async def test_customer_declines_and_contractor_is_told(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    rid = await _claim(db, u["c1"])
    r = await _call(db, u["cust"], "POST", f"/api/v1/projects/p-ar/assignment-requests/{rid}/decline")
    assert r.status_code == 200 and r.json()["status"] == "declined"
    assert await _lead(db) is None
    note = await db.scalar(select(AppNotification).where(AppNotification.user_id == "c1-ar"))
    assert note is not None
    # a declined claim can be raised again
    assert await _claim(db, u["c1"]) != rid


@pytest.mark.asyncio
async def test_foreign_customer_and_contractor_cannot_resolve(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    rid = await _claim(db, u["c1"])
    for actor in (u["other"], u["c1"], u["c2"]):
        r = await _call(db, actor, "POST", f"/api/v1/projects/p-ar/assignment-requests/{rid}/accept")
        assert r.status_code == 403
    assert await _lead(db) is None


@pytest.mark.asyncio
async def test_free_limit_enforced_on_accept(db, monkeypatch):
    u, _ = await _seed(db)
    monkeypatch.setattr(assignment_service.settings, "contractor_free_project_limit", 1)
    db.add(Project(
        id="p-busy", name="Занят", renovation_type="cosmetic", customer_id="cu2-ar",
        contractor_id="c1-ar", budget_planned=1, budget_spent=0,
    ))
    await db.commit()
    rid = await _claim(db, u["c1"])
    r = await _call(db, u["cust"], "POST", f"/api/v1/projects/p-ar/assignment-requests/{rid}/accept")
    assert r.status_code == 402
    assert await _lead(db) is None
    assert (await _fresh(db, ProjectAssignmentRequest, rid)).status == "pending"


@pytest.mark.asyncio
async def test_direct_link_accepts_profile_id_and_self_claim_helper_route_is_owner_only(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    db.add(ContractorProfile(id="prof-ar", user_id="c2-ar", visible=True))
    await db.commit()
    by_profile = await _call(db, u["cust"], "POST", "/api/v1/projects/p-ar/contractor",
                             json={"contractor_id": "prof-ar"})
    assert by_profile.status_code == 200, by_profile.text
    assert await _lead(db) == "c2-ar"
    # a contractor can no longer link himself through the customer route
    forbidden = await _call(db, u["c1"], "POST", "/api/v1/projects/p-ar/contractor",
                            json={"contractor_id": "c1-ar"})
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_release_free_then_replace(db, monkeypatch):
    u, project = await _seed(db, monkeypatch)
    project.estimate_locked_at = project.created_at if hasattr(project, "created_at") else None
    assert (await _call(db, u["cust"], "POST", "/api/v1/projects/p-ar/contractor",
                        json={"contractor_id": "c1-ar"})).status_code == 200
    swap = await _call(db, u["cust"], "POST", "/api/v1/projects/p-ar/contractor",
                       json={"contractor_id": "c2-ar"})
    assert swap.status_code == 409  # replacing needs an explicit release first
    rel = await _call(db, u["cust"], "DELETE", "/api/v1/projects/p-ar/contractor")
    assert rel.status_code == 200, rel.text
    assert await _lead(db) is None
    assert (await _fresh(db, Project, "p-ar")).estimate_locked_at is None
    again = await _call(db, u["cust"], "DELETE", "/api/v1/projects/p-ar/contractor")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "no_contractor"
    assert (await _call(db, u["cust"], "POST", "/api/v1/projects/p-ar/contractor",
                        json={"contractor_id": "c2-ar"})).status_code == 200
    assert await _lead(db) == "c2-ar"
    foreign = await _call(db, u["other"], "DELETE", "/api/v1/projects/p-ar/contractor")
    assert foreign.status_code == 403


@pytest.mark.asyncio
async def test_release_blocked_by_started_stage_and_signed_document(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    await _call(db, u["cust"], "POST", "/api/v1/projects/p-ar/contractor", json={"contractor_id": "c1-ar"})
    stage = Stage(id="st-ar", project_id="p-ar", name="Демонтаж", sort_order=0, status=StageStatus.active)
    db.add(stage)
    await db.commit()
    r = await _call(db, u["cust"], "DELETE", "/api/v1/projects/p-ar/contractor")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "contractor_work_started"
    assert await _lead(db) == "c1-ar"

    stage.status = StageStatus.planned
    doc = ProjectDocument(id="doc-ar", project_id="p-ar", title="Договор", document_type="contract")
    ver = DocumentVersion(id="ver-ar", document_id="doc-ar", version_number=1)
    sig = DocumentSignature(id="sig-ar", document_id="doc-ar", version_id="ver-ar",
                            signer_user_id="cu-ar", status="signed")
    db.add_all([doc, ver, sig])
    await db.commit()
    r = await _call(db, u["cust"], "DELETE", "/api/v1/projects/p-ar/contractor")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "contractor_has_signed_documents"
    assert await _lead(db) == "c1-ar"


@pytest.mark.asyncio
async def test_join_by_code_creates_request_only_and_lists_names(db, monkeypatch):
    u, _ = await _seed(db, monkeypatch)
    code = "p-ar"  # short test id is not hex: use a real hex-id project
    db.add(Project(id="abcdef12-0000-0000-0000-000000000000", name="Hex", renovation_type="cosmetic",
                   customer_id="cu-ar", budget_planned=1, budget_spent=0))
    await db.commit()
    bad = await _call(db, u["c1"], "POST", "/api/v1/projects/join-by-code/claim", json={"code": "zzzzzzzz"})
    assert bad.status_code == 404
    ok = await _call(db, u["c1"], "POST", "/api/v1/projects/join-by-code/claim", json={"code": "ABCDEF12"})
    assert ok.status_code == 202, ok.text
    assert await _lead(db, "abcdef12-0000-0000-0000-000000000000") is None
    mine = await _call(db, u["c1"], "GET", "/api/v1/projects/me/assignment-requests")
    assert mine.status_code == 200 and mine.json()["items"][0]["project_name"] == "Hex"
    lst = await _call(db, u["cust"], "GET", "/api/v1/projects/abcdef12-0000-0000-0000-000000000000/assignment-requests")
    assert lst.status_code == 200 and lst.json()["items"][0]["contractor_name"] == "Исполнитель"
    assert (await _call(db, u["customer" if False else "other"], "GET",
            "/api/v1/projects/abcdef12-0000-0000-0000-000000000000/assignment-requests")).status_code in (403, 404)
