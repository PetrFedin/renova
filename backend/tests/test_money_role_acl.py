"""Ролевые проверки денег и параметров проекта (ROLE-001/004, STG-001, MNY-001,
EST-012, APIB-008/009/010): заказчик решает по деньгам, исполнитель исполняет."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    Project, Purchase, PurchaseStatus, Stage, StageStatus, Team, TeamMember, User, UserRole,
)

PID = "p-moneyacl"


async def _seed(db):
    customer = User(id="cu-mny", phone="+79990007001", role=UserRole.customer)
    lead = User(id="ld-mny", phone="+79990007002", role=UserRole.contractor)
    foreman = User(id="fm-mny", phone="+79990007003", role=UserRole.contractor)
    member = User(id="mb-mny", phone="+79990007004", role=UserRole.contractor)
    project = Project(
        id=PID, name="Orig", renovation_type="cosmetic", customer_id=customer.id,
        contractor_id=lead.id, budget_planned=100000, budget_spent=0,
    )
    team = Team(id="tm-mny", name="T", owner_id=lead.id)
    s1 = Stage(id="s1-mny", project_id=PID, name="S1", sort_order=1, payment_amount=0)
    s2 = Stage(id="s2-mny", project_id=PID, name="S2", sort_order=2, payment_amount=0)
    db.add_all([customer, lead, foreman, member, project, team, s1, s2])
    await db.flush()
    db.add_all([
        TeamMember(team_id=team.id, user_id=foreman.id, role="foreman"),
        TeamMember(team_id=team.id, user_id=member.id, role="member"),
    ])
    await db.commit()
    return {"customer": customer, "lead": lead, "foreman": foreman, "member": member}


async def _call(db, actor, method, url, **kw):
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


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["lead", "foreman", "member"])
async def test_patch_project_forbidden_for_contractor_side(db, role):
    users = await _seed(db)
    r = await _call(db, users[role], "PATCH", f"/api/v1/projects/{PID}",
                    json={"name": "HACK", "vat_rate": 20, "customer_budget": 1})
    assert r.status_code == 403, r.text
    db.expire_all()
    p = await db.get(Project, PID)
    assert p.name == "Orig" and p.customer_budget is None and not p.vat_rate


@pytest.mark.asyncio
async def test_patch_project_allowed_for_customer_and_budget_hidden_from_others(db):
    users = await _seed(db)
    r = await _call(db, users["customer"], "PATCH", f"/api/v1/projects/{PID}",
                    json={"name": "New", "customer_budget": 500000})
    assert r.status_code == 200, r.text
    assert r.json()["customer_budget"] == 500000
    for role in ("lead", "foreman", "member"):
        g = await _call(db, users[role], "GET", f"/api/v1/projects/{PID}")
        assert g.status_code == 200, g.text
        assert g.json()["customer_budget"] is None
    lst = await _call(db, users["lead"], "GET", "/api/v1/projects")
    assert all(item["customer_budget"] is None for item in lst.json())
    own = await _call(db, users["customer"], "GET", f"/api/v1/projects/{PID}")
    assert own.json()["customer_budget"] == 500000


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["lead", "foreman", "member"])
async def test_payment_plan_forbidden_for_contractor_side(db, role):
    users = await _seed(db)
    r = await _call(db, users[role], "PATCH", f"/api/v1/projects/{PID}/stages/payment-plan",
                    json={"amounts": {"s1-mny": 90000}})
    assert r.status_code == 403, r.text
    db.expire_all()
    assert (await db.get(Stage, "s1-mny")).payment_amount == 0


@pytest.mark.asyncio
async def test_payment_plan_customer_ok_and_total_validated(db):
    users = await _seed(db)
    url = f"/api/v1/projects/{PID}/stages/payment-plan"
    ok = await _call(db, users["customer"], "PATCH", url, json={"amounts": {"s1-mny": 60000, "s2-mny": 40000}})
    assert ok.status_code == 200, ok.text
    over = await _call(db, users["customer"], "PATCH", url, json={"amounts": {"s1-mny": 90000}})
    assert over.status_code == 422, over.text
    assert over.json()["detail"]["code"] == "payment_plan_exceeds_total"
    db.expire_all()
    assert (await db.get(Stage, "s1-mny")).payment_amount == 60000


@pytest.mark.asyncio
async def test_payment_plan_locked_stage_conflict(db):
    users = await _seed(db)
    st = await db.get(Stage, "s1-mny")
    st.status = StageStatus.done
    st.payment_amount = 1000
    await db.commit()
    r = await _call(db, users["customer"], "PATCH", f"/api/v1/projects/{PID}/stages/payment-plan",
                    json={"amounts": {"s1-mny": 2000}})
    assert r.status_code == 409, r.text


async def _purchase(db, status):
    pur = Purchase(id="pu-mny", project_id=PID, status=status, total_amount=300)
    db.add(pur)
    await db.commit()


async def _set(db, actor, target):
    return await _call(db, actor, "POST", f"/api/v1/projects/{PID}/purchases/pu-mny/status",
                       json={"status": target})


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["lead", "foreman", "member"])
async def test_purchase_paid_forbidden_for_contractor_side(db, role):
    users = await _seed(db)
    await _purchase(db, PurchaseStatus.ordered)
    r = await _set(db, users[role], "paid")
    assert r.status_code == 403, r.text
    db.expire_all()
    p = await db.get(Purchase, "pu-mny")
    assert p.status == PurchaseStatus.ordered
    assert (await db.get(Project, PID)).budget_spent == 0


@pytest.mark.asyncio
async def test_purchase_customer_confirms_paid_then_lead_delivers(db):
    users = await _seed(db)
    await _purchase(db, PurchaseStatus.ordered)
    assert (await _set(db, users["customer"], "paid")).status_code == 200
    assert (await _set(db, users["lead"], "delivered")).status_code == 200


@pytest.mark.asyncio
async def test_purchase_skips_are_blocked(db):
    users = await _seed(db)
    await _purchase(db, PurchaseStatus.draft)
    for actor in ("customer", "lead"):
        r = await _set(db, users[actor], "delivered")
        assert r.status_code == 409, r.text
    r = await _set(db, users["customer"], "paid")
    assert r.status_code == 409, r.text
    db.expire_all()
    assert (await db.get(Purchase, "pu-mny")).status == PurchaseStatus.draft


@pytest.mark.asyncio
async def test_purchase_contractor_cannot_deliver_unpaid(db):
    users = await _seed(db)
    await _purchase(db, PurchaseStatus.ordered)
    r = await _set(db, users["lead"], "delivered")
    assert r.status_code == 409, r.text
