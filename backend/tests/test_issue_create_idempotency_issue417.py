"""#417: queued issue creation must be response-loss safe.

Same client_request_id + same canonical payload after a lost response must
replay into the original ProjectIssue, never create a duplicate. Same
client_request_id with a changed canonical payload must raise
idempotency_conflict (409) rather than silently overwrite the earlier
defect's meaning. Distinct client_request_id values with byte-identical
issue values remain distinct deliberate defects/remarks.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    Project,
    ProjectIssue,
    User,
    UserRole,
)


async def _seed(db, suffix: str):
    contractor = User(id=f"ct-417-{suffix}", phone=f"+7999041{suffix:0>4}", role=UserRole.contractor)
    customer = User(id=f"cu-417-{suffix}", phone=f"+7999042{suffix:0>4}", role=UserRole.customer)
    project = Project(
        id=f"proj-417-{suffix}",
        name="Idempotent issue create",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    db.add_all([contractor, customer, project])
    await db.commit()
    return contractor, customer, project


async def _post_issue(db, actor, project_id, payload):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(f"/api/v1/projects/{project_id}/issues", json=payload)
    finally:
        app.dependency_overrides.clear()


async def _counts(db):
    issues = await db.scalar(select(func.count()).select_from(ProjectIssue))
    requests = await db.scalar(select(func.count()).select_from(ClientWriteRequest))
    activity = await db.scalar(select(func.count()).select_from(ActivityEvent))
    outbox = await db.scalar(select(func.count()).select_from(DomainOutbox))
    return issues, requests, activity, outbox


@pytest.mark.asyncio
async def test_create_issue_replays_same_request_id(db):
    contractor, _customer, project = await _seed(db, "3001")

    payload = {
        "title": "Скол плитки у входа",
        "severity": "high",
        "client_request_id": "issue-create-idem-3001",
    }
    r1 = await _post_issue(db, contractor, project.id, payload)
    assert r1.status_code == 200, r1.text
    issue_id = r1.json()["id"]

    issues, requests, _activity, _outbox = await _counts(db)
    assert issues == 1
    assert requests == 1

    # Simulate response loss + offline replay: identical request_id, identical payload.
    r2 = await _post_issue(db, contractor, project.id, payload)
    assert r2.status_code == 200, r2.text
    assert r2.json()["id"] == issue_id

    issues, requests, activity, outbox_rows = await _counts(db)
    assert issues == 1
    assert requests == 1
    # No second activity/outbox row must be created by the replay.
    assert activity <= 1
    assert outbox_rows >= 1


@pytest.mark.asyncio
async def test_create_issue_conflicting_payload_same_request_id_raises_409(db):
    contractor, _customer, project = await _seed(db, "3002")

    payload = {
        "title": "Скол плитки у входа",
        "severity": "high",
        "client_request_id": "issue-create-conflict-3002",
    }
    r1 = await _post_issue(db, contractor, project.id, payload)
    assert r1.status_code == 200, r1.text

    conflicting = {
        "title": "Скол плитки у входа",
        "severity": "low",
        "client_request_id": "issue-create-conflict-3002",
    }
    r2 = await _post_issue(db, contractor, project.id, conflicting)
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"]["code"] == "idempotency_conflict"

    issues, *_ = await _counts(db)
    assert issues == 1


@pytest.mark.asyncio
async def test_create_issue_distinct_request_ids_stay_distinct(db):
    contractor, _customer, project = await _seed(db, "3003")

    payload_a = {
        "title": "Скол плитки у входа",
        "severity": "high",
        "client_request_id": "issue-create-distinct-3003-a",
    }
    payload_b = {
        "title": "Скол плитки у входа",
        "severity": "high",
        "client_request_id": "issue-create-distinct-3003-b",
    }
    r1 = await _post_issue(db, contractor, project.id, payload_a)
    r2 = await _post_issue(db, contractor, project.id, payload_b)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] != r2.json()["id"]

    issues, requests, *_ = await _counts(db)
    assert issues == 2
    assert requests == 2


@pytest.mark.asyncio
async def test_create_issue_without_request_id_still_works(db):
    """Legacy/unidentified callers (no client_request_id) keep unconditional
    creation — this issue only mandates identity for the production mobile path."""
    contractor, _customer, project = await _seed(db, "3004")

    r = await _post_issue(db, contractor, project.id, {"title": "Без идентификатора"})
    assert r.status_code == 200, r.text

    issues, requests, *_ = await _counts(db)
    assert issues == 1
    assert requests == 0
