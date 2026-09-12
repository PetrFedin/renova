"""#406 / parent #316: estimate-line create replays one line and one budget delta."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "estimate_line_replay.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    from app.db import session as sess
    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _fresh_project(client: AsyncClient):
    contractor = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    h_cont = {"X-User-Id": contractor["id"]}
    h_cust = {"X-User-Id": customer["id"]}
    created = await client.post(
        "/api/v1/projects/from-template",
        headers=h_cust,
        json={
            "template_id": "studio",
            "name": "Estimate replay project",
            "client_request_id": "estimate-project-create-001",
        },
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    # Link the chosen contractor as the project owner. Do not use /assign here:
    # that is the contractor self-claim commercial path and correctly requires Pro.
    assigned = await client.post(
        f"/api/v1/projects/{project_id}/contractor",
        headers=h_cust,
        json={"contractor_id": contractor["id"]},
    )
    assert assigned.status_code == 200, assigned.text
    return project_id, h_cont


async def test_same_intent_replays_one_line_and_one_budget_delta():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        project_id, headers = await _fresh_project(client)
        before = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        budget_before = float(before["budget_planned"])
        payload = {
            "client_request_id": "estimate-line-response-loss-001",
            "line_type": "material",
            "name": "Replay tile",
            "unit": "m2",
            "quantity_planned": 2.5,
            "unit_price": 4000,
            "category": "materials",
            "notes": "one logical line",
        }
        path = f"/api/v1/projects/{project_id}/estimate/lines"

        first = await client.post(path, headers=headers, json=payload)
        assert first.status_code == 200, first.text
        first_body = first.json()
        assert first_body["idempotent_replay"] is False

        replay = await client.post(path, headers=headers, json=payload)
        assert replay.status_code == 200, replay.text
        assert replay.json()["id"] == first_body["id"]
        assert replay.json()["idempotent_replay"] is True

        detail = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        matching = [row for row in detail["estimate_lines"] if row["name"] == "Replay tile"]
        assert len(matching) == 1
        assert float(detail["budget_planned"]) == pytest.approx(budget_before + 10_000.0)

        conflict = await client.post(path, headers=headers, json={**payload, "quantity_planned": 3})
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["detail"]["code"] == "idempotency_conflict"

        distinct = await client.post(
            path,
            headers=headers,
            json={**payload, "client_request_id": "estimate-line-response-loss-002"},
        )
        assert distinct.status_code == 200, distinct.text
        assert distinct.json()["id"] != first_body["id"]
        after_distinct = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        matching = [row for row in after_distinct["estimate_lines"] if row["name"] == "Replay tile"]
        assert len(matching) == 2
        assert float(after_distinct["budget_planned"]) == pytest.approx(budget_before + 20_000.0)
