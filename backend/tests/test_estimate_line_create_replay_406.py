"""#406: estimate-line create must be replay-safe for a queued mobile retry.

The backend already accepted an optional `client_request_id` on
`POST /projects/{project_id}/estimate/lines` and routed it through the shared
`client_write_idempotency` ledger (`replay_entity_id`/`commit_client_write`),
but only a service-level unit test proved ordinary ledger replay for
`prepare_line` — nothing exercised the actual HTTP create endpoint end to end,
and nothing proved a same-key retry does not double-count
`project.budget_planned`. This closes that gap at the API layer:

- same key + same canonical line payload replays the original line and
  leaves `budget_planned` unchanged on the second call;
- same key + a changed line payload is a 409 `idempotency_conflict`, and the
  line/budget from the first call are untouched;
- distinct keys with otherwise identical visible values remain distinct
  lines and both amounts land in `budget_planned`.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import EstimateLine, Project, User, UserRole


async def _seed(db):
    contractor = User(id="ct-est406", phone="+79990007001", role=UserRole.contractor)
    customer = User(id="cu-est406", phone="+79990007002", role=UserRole.customer)
    project = Project(
        id="pr-est406", name="A", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=0, budget_spent=0,
    )
    db.add_all([contractor, customer, project])
    await db.commit()
    return contractor, project


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


async def _line_count(db):
    from sqlalchemy import func, select
    return await db.scalar(select(func.count()).select_from(EstimateLine))


@pytest.mark.asyncio
async def test_create_line_replay_same_key_same_payload_no_double_budget(db):
    contractor, project = await _seed(db)
    project_id = project.id
    client = await _client(db, contractor)
    body = {
        "line_type": "material",
        "name": "Плитка",
        "unit": "m2",
        "quantity_planned": 10,
        "unit_price": 500,
        "client_request_id": "est406-req-1",
    }
    try:
        r1 = await client.post(f"/api/v1/projects/{project_id}/estimate/lines", json=body)
        r2 = await client.post(f"/api/v1/projects/{project_id}/estimate/lines", json=body)
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]
    assert r1.json()["idempotent_replay"] is False
    assert r2.json()["idempotent_replay"] is True
    assert await _line_count(db) == 1

    fresh = await db.get(Project, project_id)
    assert fresh.budget_planned == pytest.approx(5000.0)


@pytest.mark.asyncio
async def test_create_line_same_key_changed_payload_conflicts(db):
    contractor, project = await _seed(db)
    project_id = project.id
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_id}/estimate/lines",
            json={
                "line_type": "material",
                "name": "Плитка",
                "unit": "m2",
                "quantity_planned": 10,
                "unit_price": 500,
                "client_request_id": "est406-req-2",
            },
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_id}/estimate/lines",
            json={
                "line_type": "material",
                "name": "Плитка",
                "unit": "m2",
                "quantity_planned": 20,
                "unit_price": 500,
                "client_request_id": "est406-req-2",
            },
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"]["code"] == "idempotency_conflict"
    assert await _line_count(db) == 1

    fresh = await db.get(Project, project_id)
    assert fresh.budget_planned == pytest.approx(5000.0)


@pytest.mark.asyncio
async def test_create_line_distinct_keys_distinct_lines(db):
    contractor, project = await _seed(db)
    project_id = project.id
    client = await _client(db, contractor)
    try:
        r1 = await client.post(
            f"/api/v1/projects/{project_id}/estimate/lines",
            json={
                "line_type": "material",
                "name": "Плитка",
                "unit": "m2",
                "quantity_planned": 10,
                "unit_price": 500,
                "client_request_id": "est406-req-3a",
            },
        )
        r2 = await client.post(
            f"/api/v1/projects/{project_id}/estimate/lines",
            json={
                "line_type": "material",
                "name": "Плитка",
                "unit": "m2",
                "quantity_planned": 10,
                "unit_price": 500,
                "client_request_id": "est406-req-3b",
            },
        )
    finally:
        await client.aclose()
        _clear_overrides()

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]
    assert await _line_count(db) == 2

    fresh = await db.get(Project, project_id)
    assert fresh.budget_planned == pytest.approx(10000.0)
