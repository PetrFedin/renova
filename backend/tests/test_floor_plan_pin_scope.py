"""A marker belongs to one sheet, in one project.

`PATCH …/floor-plans/{plan_id}/pins/{pin_id}` resolved the pin by id alone:

    pin = await db.get(FloorPlanPin, pin_id)
    if not pin: raise HTTPException(404)

`plan_id` from the URL was never looked at, and neither was the project the pin
actually belongs to. So write access to *any* project let a user move a marker
on *any other* project's sheet. Its two siblings in the same file — `upsert_pin`
and `move_furniture` — both scope correctly; this one did not.

Coordinates were unbounded too. `x_pct = -999` was accepted, and since there is
no route to delete a pin, a marker pushed off the sheet could not be recovered.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "pins.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _project_with_pin(client, headers, *, name: str):
    """A project, a sheet, a room and a marker on it."""
    created = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": name, "rooms": [{"name": "Комната", "length_m": 4, "width_m": 3}]},
    )
    assert created.status_code in (200, 201), created.text
    project_id = created.json()["id"]

    rooms = (await client.get(f"/api/v1/projects/{project_id}/rooms", headers=headers)).json()
    room_id = rooms[0]["id"]

    plan = await client.post(
        f"/api/v1/projects/{project_id}/floor-plans",
        headers=headers,
        json={"name": "План", "image_key": "photos/plan.jpg", "floor_level": 1},
    )
    assert plan.status_code in (200, 201), plan.text
    plan_id = plan.json()["id"]

    pin = await client.post(
        f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/pins",
        headers=headers,
        json={"room_id": room_id, "x_pct": 25, "y_pct": 25, "label": "Кухня"},
    )
    assert pin.status_code == 200, pin.text
    return project_id, plan_id, pin.json()["id"]


async def _pin_position(client, headers, project_id, plan_id, pin_id):
    plans = (await client.get(f"/api/v1/projects/{project_id}/floor-plans", headers=headers)).json()
    sheet = next(p for p in plans if p["id"] == plan_id)
    marker = next(p for p in sheet["pins"] if p["id"] == pin_id)
    return marker["x_pct"], marker["y_pct"]


async def test_a_marker_cannot_be_moved_through_another_projects_url():
    """The escalation: both projects belong to the same user, so a refusal can
    only be about scoping — `require_project` passes for either one."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}

        target_project, target_plan, target_pin = await _project_with_pin(
            client, headers, name="Объект с меткой"
        )
        other_project, other_plan, _ = await _project_with_pin(
            client, headers, name="Другой объект"
        )

        moved = await client.patch(
            f"/api/v1/projects/{other_project}/floor-plans/{other_plan}/pins/{target_pin}",
            headers=headers,
            json={"x_pct": 1, "y_pct": 1},
        )
        assert moved.status_code == 404, moved.text

        assert await _pin_position(client, headers, target_project, target_plan, target_pin) == (25, 25), (
            "the marker moved through a URL that names a different project"
        )


async def test_a_marker_cannot_be_moved_through_another_sheet_in_the_same_project():
    """`plan_id` was ignored entirely, not merely mis-scoped."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}

        project_id, plan_id, pin_id = await _project_with_pin(
            client, headers, name="Объект с двумя листами"
        )
        second = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans",
            headers=headers,
            json={"name": "Второй лист", "image_key": "photos/plan2.jpg", "floor_level": 2},
        )
        second_plan = second.json()["id"]

        moved = await client.patch(
            f"/api/v1/projects/{project_id}/floor-plans/{second_plan}/pins/{pin_id}",
            headers=headers,
            json={"x_pct": 1, "y_pct": 1},
        )
        assert moved.status_code == 404, moved.text
        assert await _pin_position(client, headers, project_id, plan_id, pin_id) == (25, 25)


async def test_its_own_sheet_still_moves():
    """Guards the guard: refusing everything would satisfy the cases above."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}

        project_id, plan_id, pin_id = await _project_with_pin(
            client, headers, name="Обычный объект"
        )

        moved = await client.patch(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/pins/{pin_id}",
            headers=headers,
            json={"x_pct": 70, "y_pct": 40},
        )
        assert moved.status_code == 200, moved.text
        assert await _pin_position(client, headers, project_id, plan_id, pin_id) == (70, 40)


async def test_a_marker_cannot_be_pushed_off_the_sheet():
    """There is no route to delete a pin, so off-sheet is unrecoverable."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}

        project_id, plan_id, pin_id = await _project_with_pin(
            client, headers, name="Объект границ"
        )

        for payload in ({"x_pct": -999, "y_pct": 50}, {"x_pct": 50, "y_pct": 50000}):
            refused = await client.patch(
                f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/pins/{pin_id}",
                headers=headers,
                json=payload,
            )
            assert refused.status_code == 422, (payload, refused.text)

        assert await _pin_position(client, headers, project_id, plan_id, pin_id) == (25, 25)

        # …and the same bound applies when the marker is first placed.
        rooms = (await client.get(f"/api/v1/projects/{project_id}/rooms", headers=headers)).json()
        placed = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/pins",
            headers=headers,
            json={"room_id": rooms[0]["id"], "x_pct": 150, "y_pct": 10},
        )
        assert placed.status_code == 422, placed.text
