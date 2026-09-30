"""EST-002/003/004/005/006/007/009/021, APIA-001/002/003/004: смета и расчёт материалов."""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    AppNotification,
    ChecklistTemplate,
    ChecklistTemplateVersion,
    EstimateLine,
    LineType,
    Project,
    ProjectChecklistTemplate,
    Room,
    User,
    UserRole,
)
from datetime import timedelta


async def _seed(db, tag):
    cust = User(id=f"cu-{tag}", phone=f"+7999{abs(hash(tag)) % 10**7:07d}", role=UserRole.customer)
    contr = User(id=f"ct-{tag}", phone=f"+7998{abs(hash(tag)) % 10**7:07d}", role=UserRole.contractor)
    proj = Project(
        id=f"p-{tag}", name="P", renovation_type="cosmetic",
        customer_id=cust.id, contractor_id=contr.id, budget_planned=1, budget_spent=0,
    )
    room = Room(id=f"r-{tag}", project_id=proj.id, name="Кухня", length_m=4, width_m=3, height_m=2.7, openings_sq_m=2)
    mat = EstimateLine(
        id=f"m-{tag}", project_id=proj.id, room_id=room.id, line_type=LineType.material,
        name="Краска", unit="pcs", quantity_planned=10, unit_price=100,
    )
    db.add_all([cust, contr, proj, room, mat])
    await db.commit()
    return cust, contr, proj, room, mat


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _call(db, actor, method, url, **kw):
    client = await _client(db, actor)
    try:
        return await getattr(client, method)(url, **kw)
    finally:
        await client.aclose()
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_calc_materials_typical_room_and_incomplete_dimensions(db):
    cust, contr, proj, room, _ = await _seed(db, "calc")
    r = await _call(db, contr, "post", f"/api/v1/projects/{proj.id}/rooms/{room.id}/calc-materials")
    assert r.status_code == 200, r.text
    items = {i["name"]: i for i in r.json()["items"]}
    assert items["Плитка"]["qty"] == round(12 * 1.10, 2)  # 4x3 = 12 м2

    room.width_m = 0
    await db.commit()
    r = await _call(db, contr, "post", f"/api/v1/projects/{proj.id}/rooms/{room.id}/calc-materials")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "room_dimensions_incomplete"


@pytest.mark.asyncio
async def test_budget_alerts_ok_and_notifies_once(db):
    cust, contr, proj, room, mat = await _seed(db, "alert")
    mat.quantity_actual = 20  # факт 2000 против плана 1000
    await db.commit()
    for _ in range(3):
        r = await _call(db, cust, "get", f"/api/v1/projects/{proj.id}/analytics/budget-alerts")
        assert r.status_code == 200, r.text
    n = (await db.execute(
        select(func.count()).select_from(AppNotification).where(
            AppNotification.user_id == cust.id, AppNotification.notification_type == "budget_alert")
    )).scalar_one()
    assert n == 1


@pytest.mark.asyncio
async def test_budget_room_lines_foreign_room_not_leaked(db):
    _, contr_a, proj_a, _, _ = await _seed(db, "ida")
    _, _, proj_b, room_b, mat_b = await _seed(db, "idb")
    mat_b.quantity_actual = 50
    await db.commit()
    r = await _call(db, contr_a, "get", f"/api/v1/projects/{proj_a.id}/analytics/budget-room-lines/{room_b.id}")
    assert r.status_code == 200 and r.json() == []
    _, contr_b = None, (await db.get(User, "ct-idb"))
    r = await _call(db, contr_b, "get", f"/api/v1/projects/{proj_b.id}/analytics/budget-room-lines/{room_b.id}")
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_checklist_template_versions_acl(db):
    cust, contr, proj_a, _, _ = await _seed(db, "cla")
    _, _, proj_b, _, _ = await _seed(db, "clb")
    tpl = ChecklistTemplate(id="tpl-cl", user_id=cust.id, name="T", items_json=json.dumps(["секрет"]))
    ptpl = ProjectChecklistTemplate(id="ptpl-cl", project_id=proj_b.id, name="P", items_json=json.dumps(["секрет"]))
    db.add_all([tpl, ptpl])
    await db.commit()
    db.add_all([
        ChecklistTemplateVersion(template_id=tpl.id, scope="user", name="T", items_json=tpl.items_json, version=1),
        ChecklistTemplateVersion(template_id=ptpl.id, scope="project", name="P", items_json=ptpl.items_json, version=1),
    ])
    await db.commit()
    r = await _call(db, contr, "get", f"/api/v1/checklist-templates/{tpl.id}/versions")
    assert r.status_code == 404
    r = await _call(db, cust, "get", f"/api/v1/checklist-templates/{tpl.id}/versions")
    assert r.status_code == 200 and len(r.json()) == 1
    for tail in ("versions", "diff"):
        r = await _call(db, contr, "get", f"/api/v1/projects/{proj_a.id}/checklist-templates/{ptpl.id}/{tail}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_validation_notes_and_fact_after_lock(db):
    cust, contr, proj, _, mat = await _seed(db, "patch")
    url = f"/api/v1/projects/{proj.id}/estimate/lines/{mat.id}"
    for body in ({"quantity_planned": -5}, {"quantity_planned": 0}, {"unit_price": -1}, {"quantity_actual": -1}):
        r = await _call(db, contr, "patch", url, json=body)
        assert r.status_code == 422, (body, r.text)
    r = await _call(db, contr, "patch", url, json={"quantity_actual": 0, "notes": "Dulux 5л"})
    assert r.status_code == 200
    await db.refresh(mat)
    assert mat.quantity_actual == 0 and mat.notes == "Dulux 5л"
    r = await _call(db, contr, "patch", url, json={"notes": ""})
    await db.refresh(mat)
    assert mat.notes is None

    proj.estimate_locked_at = utc_now()
    await db.commit()
    r = await _call(db, contr, "patch", url, json={"unit_price": 1})
    assert r.status_code == 409
    r = await _call(db, contr, "patch", url, json={"quantity_actual": 4})
    assert r.status_code == 200
    await db.refresh(mat)
    assert mat.quantity_actual == 4 and mat.unit_price == 100


@pytest.mark.asyncio
async def test_lock_expired_and_changed_since_proposal(db):
    cust, contr, proj, _, mat = await _seed(db, "lock")
    pid, mid = proj.id, mat.id
    lock = f"/api/v1/projects/{pid}/estimate/lock"
    r = await _call(db, contr, "post", f"/api/v1/projects/{pid}/estimate/propose-lock")
    assert r.status_code == 200

    # подрядчик тихо меняет цену между propose и lock -> 409, смета не зафиксирована
    r = await _call(db, contr, "patch", f"/api/v1/projects/{pid}/estimate/lines/{mid}", json={"unit_price": 99999})
    assert r.status_code == 200
    r = await _call(db, cust, "post", lock)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "estimate_changed_since_proposal"
    await db.refresh(proj)
    assert proj.estimate_locked_at is None

    # повторный propose -> lock проходит
    await _call(db, contr, "post", f"/api/v1/projects/{pid}/estimate/propose-lock")
    # но просроченное предложение -> 409 proposal_expired
    proj = await db.get(Project, pid)
    proj.estimate_lock_proposed_at = utc_now() - timedelta(days=20)
    await db.commit()
    r = await _call(db, cust, "post", lock)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "proposal_expired"
    await db.refresh(proj)
    assert proj.estimate_locked_at is None

    proj.estimate_lock_proposed_at = utc_now()
    await db.commit()
    r = await _call(db, cust, "post", lock)
    assert r.status_code == 200 and r.json()["estimate_locked_at"]


@pytest.mark.asyncio
async def test_materials_fact_single_definition(db):
    cust, contr, proj, _, mat = await _seed(db, "fact")
    pid = proj.id
    mat.quantity_actual = 3
    await db.commit()
    a = (await _call(db, cust, "get", f"/api/v1/projects/{pid}/analytics")).json()
    b = (await _call(db, cust, "get", f"/api/v1/projects/{pid}/analytics/budget-breakdown")).json()
    s = (await _call(db, cust, "get", f"/api/v1/projects/{pid}/estimate/materials-stats")).json()
    assert a["materials_fact"] == b["materials_fact"] == s["actual"] == 300
