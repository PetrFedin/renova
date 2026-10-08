"""ROLE-008/MKT-011: независимый исполнитель работает строго в своём scope."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    EstimateLine, LineType, Project, Room, Stage, User, UserRole,
)
from app.services import project_participant_service as part


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


async def _seed(db):
    cust = User(id="pa-cust", phone="+79990008001", role=UserRole.customer)
    lead = User(id="pa-lead", phone="+79990008002", role=UserRole.contractor)
    part_user = User(id="pa-part", phone="+79990008003", role=UserRole.contractor)
    stranger = User(id="pa-str", phone="+79990008004", role=UserRole.contractor)
    project = Project(
        id="pa-proj", name="Кв", renovation_type="cosmetic", customer_id=cust.id,
        contractor_id=lead.id, budget_planned=500000, budget_spent=1000, customer_budget=900000,
    )
    db.add_all([cust, lead, part_user, stranger, project])
    await db.flush()
    r1 = Room(id="pa-r1", project_id=project.id, name="Кухня", length_m=4, width_m=3, height_m=2.7, openings_sq_m=1)
    r2 = Room(id="pa-r2", project_id=project.id, name="Спальня", length_m=4, width_m=3, height_m=2.7, openings_sq_m=1)
    s1 = Stage(id="pa-s1", project_id=project.id, name="Электрика", sort_order=0,
               work_type="electrical", room_ids_json='["pa-r1"]', payment_amount=100000)
    s2 = Stage(id="pa-s2", project_id=project.id, name="Плитка", sort_order=1,
               work_type="tiling", room_ids_json='["pa-r2"]', payment_amount=50000)
    l1 = EstimateLine(id="pa-l1", project_id=project.id, line_type=LineType.work, name="Кабель",
                      unit="м", quantity_planned=10, unit_price=100, room_id="pa-r1", room_name="Кухня")
    l2 = EstimateLine(id="pa-l2", project_id=project.id, line_type=LineType.work, name="Плитка",
                      unit="м2", quantity_planned=5, unit_price=900, room_id="pa-r2", room_name="Спальня")
    db.add_all([r1, r2, s1, s2, l1, l2])
    await db.commit()
    await part.add_or_reactivate_contractor(
        db, project_id=project.id, actor_id=cust.id, contractor_id=part_user.id,
        scopes=[("stage", "pa-s1")],
    )
    return cust, lead, part_user, stranger


@pytest.mark.asyncio
async def test_participant_sees_project_in_list_and_detail_without_money(db):
    cust, lead, p, stranger = await _seed(db)
    listing = await _call(db, p, "GET", "/api/v1/projects")
    assert listing.status_code == 200
    assert [x["id"] for x in listing.json()] == ["pa-proj"]
    assert listing.json()[0]["budget_planned"] == 0 and listing.json()[0]["customer_budget"] is None

    r = await _call(db, p, "GET", "/api/v1/projects/pa-proj")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_mode"] == "participant" and body["read_only"] is True
    assert [s["id"] for s in body["stages"]] == ["pa-s1"]
    assert body["stages"][0]["payment_amount"] == 0
    assert [x["id"] for x in body["estimate_lines"]] == ["pa-l1"]
    assert body["estimate_lines"][0]["unit_price"] == 0 and body["estimate_lines"][0]["total"] == 0
    assert [x["id"] for x in body["rooms"]] == ["pa-r1"]
    assert body["budget_planned"] == 0 and body["budget_spent"] == 0
    assert body["customer_budget"] is None

    # посторонний исполнитель по-прежнему не видит проект
    assert (await _call(db, stranger, "GET", "/api/v1/projects/pa-proj")).status_code == 404
    assert (await _call(db, stranger, "GET", "/api/v1/projects")).json() == []


@pytest.mark.asyncio
async def test_connected_contractor_id_is_exposed_only_to_owner_and_lead(db):
    """Mobile определяет «исполнитель назначен» и «главный исполнитель» по project.contractor_id."""
    cust, lead, p, _ = await _seed(db)
    for actor, expected in ((cust, lead.id), (lead, lead.id), (p, None)):
        detail = await _call(db, actor, "GET", "/api/v1/projects/pa-proj")
        assert detail.status_code == 200, detail.text
        assert detail.json()["contractor_id"] == expected
        listing = await _call(db, actor, "GET", "/api/v1/projects")
        assert listing.json()[0]["contractor_id"] == expected


@pytest.mark.asyncio
async def test_participant_acts_only_inside_scope(db):
    cust, lead, p, _ = await _seed(db)
    ok = await _call(db, p, "GET", "/api/v1/projects/pa-proj/stages/pa-s1")
    assert ok.status_code == 200 and ok.json()["payment_amount"] == 0
    assert (await _call(db, p, "GET", "/api/v1/projects/pa-proj/stages/pa-s2")).status_code == 403
    c1 = await _call(db, p, "POST", "/api/v1/projects/pa-proj/stages/pa-s1/comments", json={"text": "ok"})
    assert c1.status_code == 200, c1.text
    c2 = await _call(db, p, "POST", "/api/v1/projects/pa-proj/stages/pa-s2/comments", json={"text": "no"})
    assert c2.status_code == 403
    assert c2.json()["detail"]["code"] == "participant_scope_forbidden"


@pytest.mark.asyncio
async def test_participant_has_no_money_contract_or_lead_rights(db):
    cust, lead, p, _ = await _seed(db)
    for method, url, kw in [
        ("GET", "/api/v1/projects/pa-proj/dashboard", {}),
        ("GET", "/api/v1/projects/pa-proj/payments", {}),
        ("GET", "/api/v1/projects/pa-proj/payment-requisites", {}),
        ("GET", "/api/v1/projects/pa-proj/contract-gate", {}),
        ("GET", "/api/v1/projects/pa-proj/viewers", {}),
        ("PATCH", "/api/v1/projects/pa-proj", {"json": {"name": "x"}}),
        ("POST", "/api/v1/projects/pa-proj/stages", {"json": {"name": "x"}}),
        ("PATCH", "/api/v1/projects/pa-proj/stages/pa-s1/dates", {"json": {}}),
    ]:
        r = await _call(db, p, method, url, **kw)
        assert r.status_code in (403, 404, 405, 422), (url, r.status_code, r.text)
        assert r.status_code != 200, url


@pytest.mark.asyncio
async def test_removed_participant_loses_access(db):
    cust, lead, p, _ = await _seed(db)
    part_row = await part.active_participant(db, project_id="pa-proj", user_id=p.id)
    await part.remove_contractor(db, project_id="pa-proj", participant_id=part_row.id, actor_id=cust.id)
    assert (await _call(db, p, "GET", "/api/v1/projects/pa-proj")).status_code == 404
    assert (await _call(db, p, "GET", "/api/v1/projects")).json() == []

def test_project_detail_route_masks_foreign_forbidden_as_not_found():
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "projects.py"
    ).read_text(encoding="utf-8")
    start = source.index('@router.get("/{project_id}", response_model=ProjectDetail)')
    end = source.index("\n\n@router.", start + 1)
    block = source[start:end]

    assert "participant_ok=True" in block
    assert "exc.status_code == 403" in block
    assert 'HTTPException(404, "Проект не найден")' in block
