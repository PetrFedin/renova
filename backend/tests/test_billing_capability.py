"""MNY-004: invoices and change orders need the billing capability (lead/foreman), not a plain team member."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import Project, Stage, Team, TeamMember, User, UserRole

PID = "p-billing"


async def _seed(db):
    customer = User(id="cu-bil", phone="+79990009001", role=UserRole.customer)
    lead = User(id="ld-bil", phone="+79990009002", role=UserRole.contractor)
    foreman = User(id="fm-bil", phone="+79990009003", role=UserRole.contractor)
    member = User(id="mb-bil", phone="+79990009004", role=UserRole.contractor)
    viewer = User(id="vw-bil", phone="+79990009005", role=UserRole.contractor)
    project = Project(
        id=PID, name="B", renovation_type="cosmetic", customer_id=customer.id,
        contractor_id=lead.id, budget_planned=100000, budget_spent=0,
    )
    team = Team(id="tm-bil", name="T", owner_id=lead.id)
    stage = Stage(id="s1-bil", project_id=PID, name="S1", sort_order=1, payment_amount=10000)
    db.add_all([customer, lead, foreman, member, viewer, project, team, stage])
    await db.flush()
    db.add_all([
        TeamMember(team_id=team.id, user_id=foreman.id, role="foreman"),
        TeamMember(team_id=team.id, user_id=member.id, role="member"),
        TeamMember(team_id=team.id, user_id=viewer.id, role="viewer"),
    ])
    await db.commit()
    return {"lead": lead, "foreman": foreman, "member": member, "viewer": viewer}


async def _post(db, actor, url, body):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.post(url, json=body)
    finally:
        app.dependency_overrides.clear()


INVOICE = {"title": "Этап 1", "amount": 5000, "payment_type": "stage", "stage_id": "s1-bil"}
CO = {"title": "Доп. розетки", "amount": 3000, "description": "x", "client_request_id": "bil-co-0001"}


@pytest.mark.asyncio
@pytest.mark.parametrize("role,code", [("lead", 200), ("foreman", 200), ("member", 403), ("viewer", 403)])
async def test_invoice_requires_billing_capability(db, role, code):
    s = await _seed(db)
    r = await _post(db, s[role], f"/api/v1/projects/{PID}/payments", INVOICE)
    assert r.status_code == code, r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("role,code", [("lead", 200), ("foreman", 200), ("member", 403), ("viewer", 403)])
async def test_change_order_requires_billing_capability(db, role, code):
    s = await _seed(db)
    r = await _post(db, s[role], f"/api/v1/projects/{PID}/change-orders", {**CO, "client_request_id": f"bil-co-{role}-1"})
    assert r.status_code == code, r.text
