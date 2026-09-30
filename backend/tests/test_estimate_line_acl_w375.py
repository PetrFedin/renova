"""#375: estimate line mutation must bind line_id to the path project.

`PATCH /projects/{project_id}/estimate/lines/{line_id}` authorized only the
path project via require_project(), then resolved `line_id` independently
(db.get(EstimateLine, line_id)) without checking `EstimateLine.project_id ==
project_id` — a contractor with write access to project A could mutate an
estimate line that actually belongs to project B by guessing/observing its
id. Fixed by resolving (line_id, project_id) in a single query; cross-project
targets now return 404 and leave the other project's line untouched.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import EstimateLine, LineType, Project, User, UserRole


async def _seed(db):
    contractor = User(id="ct-est375", phone="+79990006001", role=UserRole.contractor)
    customer = User(id="cu-est375", phone="+79990006002", role=UserRole.customer)
    project_a = Project(
        id="pa-est375", name="A", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=1, budget_spent=0,
    )
    project_b = Project(
        id="pb-est375", name="B", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id="ct-other-est375",
        budget_planned=1, budget_spent=0,
    )
    line_a = EstimateLine(
        id="line-a-est375", project_id=project_a.id, line_type=LineType.material,
        name="Paint A", unit="pcs", quantity_planned=1, unit_price=100,
    )
    line_b = EstimateLine(
        id="line-b-est375", project_id=project_b.id, line_type=LineType.material,
        name="Paint B", unit="pcs", quantity_planned=1, unit_price=200,
    )
    db.add_all([contractor, customer, project_a, project_b, line_a, line_b])
    await db.commit()
    return contractor, project_a, project_b, line_a, line_b


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _clear_overrides():
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_patch_line_cross_project_rejected(db):
    contractor, project_a, project_b, line_a, line_b = await _seed(db)

    client = await _client(db, contractor)
    try:
        # Contractor has write access to project_a, but line_b belongs to
        # project_b (a different contractor). Guessing line_b's id under the
        # project_a path must not mutate it.
        r = await client.patch(
            f"/api/v1/projects/{project_a.id}/estimate/lines/{line_b.id}",
            json={"unit_price": 999},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 404, r.text
    fresh = await db.get(EstimateLine, line_b.id)
    assert fresh.unit_price == 200


@pytest.mark.asyncio
async def test_patch_line_same_project_works(db):
    contractor, project_a, project_b, line_a, line_b = await _seed(db)

    client = await _client(db, contractor)
    try:
        r = await client.patch(
            f"/api/v1/projects/{project_a.id}/estimate/lines/{line_a.id}",
            json={"unit_price": 150},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 200, r.text
    fresh = await db.get(EstimateLine, line_a.id)
    assert fresh.unit_price == 150
