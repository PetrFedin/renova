"""#377 / #442 / #468 / #475: floor-plan pin/furniture ACL binding + replay safety.

- #377: PATCH pin by (plan_id, pin_id) and POST furniture with room_id/
  floor_plan_id must bind the referenced rows to the path project before any
  mutation (privacy-preserving 404 on mismatch, same as a nonexistent row).
- #442/#468/#475: floor-plan create, furniture create and pin upsert must be
  replay-safe via a stable client_request_id — same key/same payload replays
  the original entity, same key/changed payload is a 409, distinct keys with
  identical visible payloads remain distinct.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import (
    DomainOutbox,
    FloorPlan,
    FloorPlanPin,
    FurnitureItem,
    Project,
    Room,
    User,
    UserRole,
)


async def _seed(db):
    contractor = User(id="ct-fp", phone="+79990005001", role=UserRole.contractor)
    customer = User(id="cu-fp", phone="+79990005002", role=UserRole.customer)
    project_a = Project(
        id="pa-fp", name="A", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=1, budget_spent=0,
    )
    project_b = Project(
        id="pb-fp", name="B", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id="ct-other-fp",
        budget_planned=1, budget_spent=0,
    )
    room_a = Room(id="room-a-fp", project_id=project_a.id, name="Kitchen A", length_m=3, width_m=3)
    room_b = Room(id="room-b-fp", project_id=project_b.id, name="Kitchen B", length_m=3, width_m=3)
    plan_a = FloorPlan(id="plan-a-fp", project_id=project_a.id, image_key="a.png")
    plan_b = FloorPlan(id="plan-b-fp", project_id=project_b.id, image_key="b.png")
    db.add_all([contractor, customer, project_a, project_b, room_a, room_b, plan_a, plan_b])
    await db.commit()
    return contractor, project_a, project_b, room_a, room_b, plan_a, plan_b


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


async def _pin_count(db):
    return await db.scalar(select(func.count()).select_from(FloorPlanPin))


async def _furniture_count(db):
    return await db.scalar(select(func.count()).select_from(FurnitureItem))


async def _plan_count(db):
    return await db.scalar(select(func.count()).select_from(FloorPlan))


# --- #377: IDOR ---------------------------------------------------------


@pytest.mark.asyncio
async def test_move_pin_cross_project_rejected(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    # Pin lives on plan_b/project_b.
    pin_b = FloorPlanPin(id="pin-b-fp", floor_plan_id=plan_b.id, room_id=room_b.id, x_pct=10, y_pct=10)
    db.add(pin_b)
    await db.commit()

    client = await _client(db, contractor)
    try:
        # Attacker with write access to project_a tries to move a pin that
        # actually belongs to plan_b/project_b, by guessing plan_a as the
        # path plan_id.
        r = await client.patch(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins/{pin_b.id}",
            json={"x_pct": 90, "y_pct": 90},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 404, r.text
    fresh = await db.get(FloorPlanPin, pin_b.id)
    assert fresh.x_pct == 10 and fresh.y_pct == 10


@pytest.mark.asyncio
async def test_move_pin_same_project_works(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    pin_a = FloorPlanPin(id="pin-a-fp", floor_plan_id=plan_a.id, room_id=room_a.id, x_pct=10, y_pct=10)
    db.add(pin_a)
    await db.commit()

    client = await _client(db, contractor)
    try:
        r = await client.patch(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins/{pin_a.id}",
            json={"x_pct": 77, "y_pct": 33},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 200, r.text
    fresh = await db.get(FloorPlanPin, pin_a.id)
    assert fresh.x_pct == 77 and fresh.y_pct == 33


@pytest.mark.asyncio
async def test_create_furniture_cross_project_room_rejected(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "room_id": room_b.id},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 404, r.text
    assert await _furniture_count(db) == 0


@pytest.mark.asyncio
async def test_create_furniture_cross_project_floor_plan_rejected(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "floor_plan_id": plan_b.id},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 404, r.text
    assert await _furniture_count(db) == 0


@pytest.mark.asyncio
async def test_create_furniture_same_project_refs_work(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "room_id": room_a.id, "floor_plan_id": plan_a.id},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 200, r.text
    assert await _furniture_count(db) == 1


# --- #442/#468: furniture create replay safety --------------------------


@pytest.mark.asyncio
async def test_create_furniture_replay_same_key_same_payload(db):
    contractor, project_a, *_ = await _seed(db)
    client = await _client(db, contractor)
    body = {"name": "Sofa", "width_m": 2.1, "depth_m": 0.9, "client_request_id": "furn-req-1"}
    try:
        r1 = await client.post(f"/api/v1/projects/{project_a.id}/furniture", json=body)
        r2 = await client.post(f"/api/v1/projects/{project_a.id}/furniture", json=body)
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]
    assert r1.json()["replayed"] is False
    assert r2.json()["replayed"] is True
    assert await _furniture_count(db) == 1


@pytest.mark.asyncio
async def test_create_furniture_same_key_changed_payload_conflicts(db):
    contractor, project_a, *_ = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "client_request_id": "furn-req-2"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Chair", "client_request_id": "furn-req-2"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 409, r2.text
    assert await _furniture_count(db) == 1


@pytest.mark.asyncio
async def test_create_furniture_distinct_keys_distinct_entities(db):
    contractor, project_a, *_ = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "client_request_id": "furn-req-3a"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/furniture",
            json={"name": "Sofa", "client_request_id": "furn-req-3b"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]
    assert await _furniture_count(db) == 2


# --- #442/#475: floor-plan create replay safety --------------------------


@pytest.mark.asyncio
async def test_create_floor_plan_replay_same_key_same_payload(db):
    contractor, project_a, *_ = await _seed(db)
    client = await _client(db, contractor)
    body = {"name": "Этаж 1", "image_key": "img.png", "client_request_id": "plan-req-1"}
    try:
        r1 = await client.post(f"/api/v1/projects/{project_a.id}/floor-plans", json=body)
        r2 = await client.post(f"/api/v1/projects/{project_a.id}/floor-plans", json=body)
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["replayed"] is True
    assert await _plan_count(db) == 3  # plan_a + plan_b seeded, plus the one created
    # Activity emitted exactly once for the create, not once per replay.
    activity_rows = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "floor_plan",
            DomainOutbox.aggregate_id == r1.json()["id"],
        )
    )
    assert activity_rows == 1


@pytest.mark.asyncio
async def test_create_floor_plan_same_key_changed_payload_conflicts(db):
    contractor, project_a, *_ = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans",
            json={"name": "Этаж 1", "image_key": "img1.png", "client_request_id": "plan-req-2"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans",
            json={"name": "Этаж 1", "image_key": "img2.png", "client_request_id": "plan-req-2"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200
    assert r2.status_code == 409, r2.text
    assert await _plan_count(db) == 3  # plan_a + plan_b seeded, plus the one created


# --- #475: pin upsert replay safety / evidence atomicity -----------------


@pytest.mark.asyncio
async def test_upsert_pin_replay_same_key_no_duplicate_activity(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    body = {"room_id": room_a.id, "x_pct": 40, "y_pct": 60, "client_request_id": "pin-req-1"}
    try:
        r1 = await client.post(f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins", json=body)
        r2 = await client.post(f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins", json=body)
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["replayed"] is True
    assert await _pin_count(db) == 1
    activity_rows = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "floor_plan_pin",
            DomainOutbox.aggregate_id == r1.json()["id"],
        )
    )
    assert activity_rows == 1


@pytest.mark.asyncio
async def test_upsert_pin_same_key_changed_payload_conflicts(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins",
            json={"room_id": room_a.id, "x_pct": 40, "y_pct": 60, "client_request_id": "pin-req-2"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins",
            json={"room_id": room_a.id, "x_pct": 41, "y_pct": 60, "client_request_id": "pin-req-2"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200
    assert r2.status_code == 409, r2.text
    assert await _pin_count(db) == 1


@pytest.mark.asyncio
async def test_upsert_pin_without_key_still_upserts_one_row_per_room(db):
    contractor, project_a, project_b, room_a, room_b, plan_a, plan_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins",
            json={"room_id": room_a.id, "x_pct": 10, "y_pct": 10},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/floor-plans/{plan_a.id}/pins",
            json={"room_id": room_a.id, "x_pct": 20, "y_pct": 20},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert await _pin_count(db) == 1
    fresh = await db.get(FloorPlanPin, r1.json()["id"])
    assert fresh.x_pct == 20 and fresh.y_pct == 20
