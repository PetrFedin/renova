"""#474: creating an Issue must bind room_id/stage_id/floor_plan_id to the path project.

ProjectIssue stores independent FKs to rooms/stages/floor_plans; the DB proves each
child exists but not that it belongs to the same project as the path. Before the
fix, POST /projects/{A}/issues accepted a room/stage/floor_plan belonging to a
different project B and created the cross-project link anyway.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import (
    FloorPlan,
    Project,
    ProjectIssue,
    Room,
    Stage,
    User,
    UserRole,
)


async def _seed(db):
    contractor = User(id="ct-474", phone="+79990004741", role=UserRole.contractor)
    customer = User(id="cu-474", phone="+79990004742", role=UserRole.customer)
    project_a = Project(
        id="pa-474", name="A", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=1, budget_spent=0,
    )
    project_b = Project(
        id="pb-474", name="B", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id="ct-other-474",
        budget_planned=1, budget_spent=0,
    )
    room_a = Room(
        id="room-a-474", project_id=project_a.id, name="Kitchen A",
        length_m=3, width_m=3,
    )
    room_b = Room(
        id="room-b-474", project_id=project_b.id, name="Kitchen B",
        length_m=3, width_m=3,
    )
    stage_a = Stage(id="stage-a-474", project_id=project_a.id, name="Demo A")
    stage_b = Stage(id="stage-b-474", project_id=project_b.id, name="Demo B")
    plan_a = FloorPlan(id="plan-a-474", project_id=project_a.id, image_key="a.png")
    plan_b = FloorPlan(id="plan-b-474", project_id=project_b.id, image_key="b.png")
    db.add_all([
        contractor, customer, project_a, project_b,
        room_a, room_b, stage_a, stage_b, plan_a, plan_b,
    ])
    await db.commit()
    return contractor, project_a, project_b, room_a, room_b, stage_a, stage_b, plan_a, plan_b


async def _post_issue(db, contractor, project_id, payload):
    async def _db():
        yield db

    async def _user():
        return contractor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(f"/api/v1/projects/{project_id}/issues", json=payload)
    finally:
        app.dependency_overrides.clear()


async def _issue_count(db):
    return await db.scalar(select(func.count()).select_from(ProjectIssue))


@pytest.mark.asyncio
async def test_cross_project_room_rejected(db):
    contractor, project_a, project_b, room_a, room_b, *_ = await _seed(db)
    r = await _post_issue(
        db, contractor, project_a.id,
        {"title": "Трещина", "room_id": room_b.id},
    )
    assert r.status_code == 404, r.text
    assert await _issue_count(db) == 0


@pytest.mark.asyncio
async def test_cross_project_stage_rejected(db):
    contractor, project_a, project_b, room_a, room_b, stage_a, stage_b, *_ = await _seed(db)
    r = await _post_issue(
        db, contractor, project_a.id,
        {"title": "Трещина", "stage_id": stage_b.id},
    )
    assert r.status_code == 404, r.text
    assert await _issue_count(db) == 0


@pytest.mark.asyncio
async def test_cross_project_floor_plan_rejected(db):
    (
        contractor, project_a, project_b, room_a, room_b,
        stage_a, stage_b, plan_a, plan_b,
    ) = await _seed(db)
    r = await _post_issue(
        db, contractor, project_a.id,
        {"title": "Трещина", "floor_plan_id": plan_b.id},
    )
    assert r.status_code == 404, r.text
    assert await _issue_count(db) == 0


@pytest.mark.asyncio
async def test_nonexistent_link_rejected(db):
    contractor, project_a, *_ = await _seed(db)
    r = await _post_issue(
        db, contractor, project_a.id,
        {"title": "Трещина", "room_id": "does-not-exist-474"},
    )
    assert r.status_code == 404, r.text
    assert await _issue_count(db) == 0


@pytest.mark.asyncio
async def test_same_project_links_still_work(db):
    (
        contractor, project_a, project_b, room_a, room_b,
        stage_a, stage_b, plan_a, plan_b,
    ) = await _seed(db)
    r = await _post_issue(
        db, contractor, project_a.id,
        {
            "title": "Трещина на стене",
            "room_id": room_a.id,
            "stage_id": stage_a.id,
            "floor_plan_id": plan_a.id,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["room_id"] == room_a.id
    assert body["stage_id"] == stage_a.id
    assert body["floor_plan_id"] == plan_a.id
    assert await _issue_count(db) == 1


@pytest.mark.asyncio
async def test_issue_without_links_still_works(db):
    contractor, project_a, *_ = await _seed(db)
    r = await _post_issue(db, contractor, project_a.id, {"title": "Без привязки"})
    assert r.status_code == 200, r.text
    assert await _issue_count(db) == 1
