"""#462 / #420 / #481: work-schedule create/submit replay safety + ACL binding.

- #481: create/replace-update items with stage_id/depends_on_item_id must be
  bound to the path project (and, for dependencies, the same schedule) before
  any mutation; foreign/missing references 404, unsafe-but-existing
  dependencies 422.
- #462/#420: schedule creation must be replay-safe via a stable
  client_request_id — same key/same payload replays the original schedule,
  same key/changed payload is a 409, distinct keys remain distinct schedules.
- #420: submit must be replay-safe — resubmitting an already-submitted
  schedule replays the current row without bumping submitted_at/version or
  re-emitting ScheduleSubmitted evidence a second time; submitting from an
  illegal state (e.g. confirmed) fails with 409 instead of silently
  re-submitting.
"""
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import DomainOutbox, Project, Stage, User, UserRole
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem, WorkScheduleStatus


async def _seed(db):
    contractor = User(id="ct-ws", phone="+79990006001", role=UserRole.contractor)
    customer = User(id="cu-ws", phone="+79990006002", role=UserRole.customer)
    project_a = Project(
        id="pa-ws", name="A", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=1, budget_spent=0,
    )
    project_b = Project(
        id="pb-ws", name="B", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id="ct-other-ws",
        budget_planned=1, budget_spent=0,
    )
    stage_a = Stage(id="stage-a-ws", project_id=project_a.id, name="Demo A", sort_order=0)
    stage_b = Stage(id="stage-b-ws", project_id=project_b.id, name="Demo B", sort_order=0)
    db.add_all([contractor, customer, project_a, project_b, stage_a, stage_b])
    await db.commit()
    return contractor, customer, project_a, project_b, stage_a, stage_b


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


async def _schedule_count(db):
    return await db.scalar(select(func.count()).select_from(ProjectWorkSchedule))


def _item_body(*, stage_id=None, depends_on_item_id=None, title="Demo item"):
    return {
        "stage_id": stage_id,
        "title": title,
        "planned_start_date": date(2026, 1, 1).isoformat(),
        "planned_finish_date": date(2026, 1, 10).isoformat(),
        "depends_on_item_id": depends_on_item_id,
    }


# --- #481: stage/dependency ACL binding on create -------------------------


@pytest.mark.asyncio
async def test_create_schedule_cross_project_stage_rejected(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(stage_id=stage_b.id)]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 404, r.text
    assert await _schedule_count(db) == 0


@pytest.mark.asyncio
async def test_create_schedule_with_dependency_rejected_422(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(depends_on_item_id="whatever")]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "work_schedule_dependency_create_not_supported"
    assert await _schedule_count(db) == 0


@pytest.mark.asyncio
async def test_create_schedule_same_project_stage_works(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(stage_id=stage_a.id)]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r.status_code == 200, r.text
    assert await _schedule_count(db) == 1


# --- #481: stage/dependency ACL binding on full-replacement update --------


@pytest.mark.asyncio
async def test_replace_schedule_cross_project_stage_rejected_and_intact(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(stage_id=stage_a.id, title="Original")]},
        )
        schedule_id = r1.json()["id"]
        original_item_id = r1.json()["items"][0]["id"]

        r2 = await client.put(
            f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}",
            json={"items": [_item_body(stage_id=stage_b.id, title="Replacement")]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 404, r2.text
    items = await db.execute(
        select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == schedule_id)
    )
    rows = items.scalars().all()
    assert len(rows) == 1
    assert rows[0].id == original_item_id
    assert rows[0].title == "Original"


@pytest.mark.asyncio
async def test_replace_schedule_dependency_from_other_schedule_404_and_intact(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan 1", "items": [_item_body(title="P1 item")]},
        )
        r_other = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan 2", "items": [_item_body(title="P2 item")]},
        )
        schedule_id = r1.json()["id"]
        other_item_id = r_other.json()["items"][0]["id"]

        r2 = await client.put(
            f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}",
            json={"items": [_item_body(depends_on_item_id=other_item_id, title="Replacement")]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r2.status_code == 404, r2.text
    items = await db.execute(
        select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == schedule_id)
    )
    rows = items.scalars().all()
    assert len(rows) == 1
    assert rows[0].title == "P1 item"


@pytest.mark.asyncio
async def test_replace_schedule_dependency_to_own_old_item_422_and_intact(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(title="Original")]},
        )
        schedule_id = r1.json()["id"]
        original_item_id = r1.json()["items"][0]["id"]

        r2 = await client.put(
            f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}",
            json={"items": [_item_body(depends_on_item_id=original_item_id, title="Replacement")]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r2.status_code == 422, r2.text
    assert r2.json()["detail"] == "work_schedule_dependency_replace_not_supported"
    items = await db.execute(
        select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == schedule_id)
    )
    rows = items.scalars().all()
    assert len(rows) == 1
    assert rows[0].id == original_item_id
    assert rows[0].title == "Original"


@pytest.mark.asyncio
async def test_replace_schedule_same_project_stage_null_dependency_succeeds(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(title="Original")]},
        )
        schedule_id = r1.json()["id"]

        r2 = await client.put(
            f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}",
            json={"items": [_item_body(stage_id=stage_a.id, title="Replacement")]},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r2.status_code == 200, r2.text
    assert r2.json()["items"][0]["stage_id"] == stage_a.id


@pytest.mark.asyncio
async def test_metadata_only_update_does_not_touch_items(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(title="Original")]},
        )
        schedule_id = r1.json()["id"]
        original_item_id = r1.json()["items"][0]["id"]

        r2 = await client.put(
            f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}",
            json={"title": "Renamed plan"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r2.status_code == 200, r2.text
    assert r2.json()["title"] == "Renamed plan"
    assert r2.json()["items"][0]["id"] == original_item_id


# --- #462/#420: schedule create replay safety ------------------------------


@pytest.mark.asyncio
async def test_create_schedule_replay_same_key_same_payload(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    body = {
        "title": "Plan",
        "items": [_item_body(title="Item 1")],
        "client_request_id": "ws-create-1",
    }
    try:
        r1 = await client.post(f"/api/v1/projects/{project_a.id}/work-schedules", json=body)
        r2 = await client.post(f"/api/v1/projects/{project_a.id}/work-schedules", json=body)
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]
    assert await _schedule_count(db) == 1
    items = await db.execute(
        select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == r1.json()["id"])
    )
    assert len(items.scalars().all()) == 1


@pytest.mark.asyncio
async def test_create_schedule_same_key_changed_payload_conflicts(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan A", "items": [], "client_request_id": "ws-create-2"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan B", "items": [], "client_request_id": "ws-create-2"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 409, r2.text
    assert await _schedule_count(db) == 1


@pytest.mark.asyncio
async def test_create_schedule_distinct_keys_distinct_schedules(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [], "client_request_id": "ws-create-3a"},
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [], "client_request_id": "ws-create-3b"},
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]
    assert await _schedule_count(db) == 2


# --- #420: submit replay safety -------------------------------------------


@pytest.mark.asyncio
async def test_submit_schedule_replay_does_not_bump_version_or_effects(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(title="Item")]},
        )
        schedule_id = r1.json()["id"]

        s1 = await client.post(f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}/submit")
        s2 = await client.post(f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}/submit")
    finally:
        await client.aclose()
        _clear_overrides()

    assert s1.status_code == 200, s1.text
    assert s2.status_code == 200, s2.text
    assert s1.json()["submitted_at"] == s2.json()["submitted_at"]
    assert s1.json()["schedule_version"] == s2.json()["schedule_version"]

    # Each submit prepares one activity row and one customer notification
    # row; a replay must add none of either on top of the first submit's two.
    effect_rows = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "work_schedule",
            DomainOutbox.aggregate_id == schedule_id,
        )
    )
    assert effect_rows == 2


@pytest.mark.asyncio
async def test_submit_confirmed_schedule_fails_deterministically(db):
    contractor, customer, project_a, project_b, stage_a, stage_b = await _seed(db)
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_a.id}/work-schedules",
            json={"title": "Plan", "items": [_item_body(title="Item")]},
        )
        schedule_id = r1.json()["id"]
        await client.post(f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}/submit")
    finally:
        await client.aclose()
        _clear_overrides()

    schedule = await db.get(ProjectWorkSchedule, schedule_id)
    schedule.status = WorkScheduleStatus.confirmed
    await db.commit()

    client2 = await _client(db, contractor)
    try:
        r2 = await client2.post(f"/api/v1/projects/{project_a.id}/work-schedules/{schedule_id}/submit")
    finally:
        await client2.aclose()
        _clear_overrides()

    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "work_schedule_submit_invalid_state"
    fresh = await db.get(ProjectWorkSchedule, schedule_id)
    assert fresh.status == WorkScheduleStatus.confirmed
