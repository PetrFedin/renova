"""Markup on a plan: what may be drawn, what it measures, and who may change it."""

from __future__ import annotations

import json

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
    db_path = tmp_path / "annotations.db"
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


async def _plan(client, headers, project_id, *, name="Планировка"):
    created = await client.post(
        f"/api/v1/projects/{project_id}/floor-plans",
        headers=headers,
        json={"name": name, "image_key": "photos/plan.jpg", "floor_level": 1},
    )
    assert created.status_code in (200, 201), created.text
    return created.json()["id"]


async def _context(client, *, role="contractor"):
    user = (await client.post("/api/v1/auth/demo", json={"role": role})).json()
    headers = {"X-User-Id": user["id"]}
    projects = (await client.get("/api/v1/projects", headers=headers)).json()
    assert projects, "demo seed must provide a project"
    return user, headers, projects[0]["id"]


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# --- what may be drawn --------------------------------------------------------


async def test_every_tool_can_be_drawn_and_read_back():
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)

        drawn = [
            ("freehand", [{"x": 1, "y": 1}, {"x": 2, "y": 3}, {"x": 4, "y": 5}], None),
            ("marker", [{"x": 10, "y": 10}, {"x": 20, "y": 20}], None),
            ("line", [{"x": 0, "y": 0}, {"x": 50, "y": 50}], None),
            ("arrow", [{"x": 5, "y": 5}, {"x": 40, "y": 10}], None),
            ("rect", [{"x": 10, "y": 10}, {"x": 30, "y": 25}], None),
            ("ellipse", [{"x": 60, "y": 60}, {"x": 80, "y": 70}], None),
            ("note", [{"x": 33, "y": 44}], "Стык плитки не сходится"),
            ("text", [{"x": 12, "y": 90}], "Ось 3"),
        ]
        for kind, points, text in drawn:
            payload = {"kind": kind, "points": points}
            if text:
                payload["text"] = text
            created = await client.post(
                f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
                headers=headers,
                json=payload,
            )
            assert created.status_code == 200, f"{kind}: {created.text}"
            assert created.json()["kind"] == kind

        listed = await client.get(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
            headers=headers,
        )
        assert listed.status_code == 200
        body = listed.json()
        assert len(body["items"]) == len(drawn)
        assert [item["kind"] for item in body["items"]] == [kind for kind, _, _ in drawn]


async def test_geometry_is_checked_against_the_tool():
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)
        url = f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations"

        # A note is a point; a ruler is a segment. Sending the wrong shape is a
        # client bug that would otherwise render as an invisible mark.
        wrong_note = await client.post(
            url, headers=headers, json={"kind": "note", "points": [{"x": 1, "y": 1}, {"x": 2, "y": 2}], "text": "x"}
        )
        assert wrong_note.status_code == 422
        assert wrong_note.json()["detail"]["code"] == "annotation_geometry_expects_point"

        wrong_measure = await client.post(
            url, headers=headers, json={"kind": "measure", "points": [{"x": 1, "y": 1}]}
        )
        assert wrong_measure.status_code == 422
        assert wrong_measure.json()["detail"]["code"] == "annotation_geometry_expects_segment"

        unknown = await client.post(
            url, headers=headers, json={"kind": "spray", "points": [{"x": 1, "y": 1}]}
        )
        assert unknown.status_code == 422
        assert unknown.json()["detail"]["code"] == "annotation_kind_unknown"

        empty_note = await client.post(
            url, headers=headers, json={"kind": "note", "points": [{"x": 1, "y": 1}], "text": "   "}
        )
        assert empty_note.status_code == 422
        assert empty_note.json()["detail"]["code"] == "annotation_text_required"


async def test_a_stroke_that_leaves_the_sheet_is_clamped_not_refused():
    """A finger sliding off the edge is an ordinary gesture."""
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)

        created = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
            headers=headers,
            json={"kind": "freehand", "points": [{"x": -30, "y": 50}, {"x": 140, "y": 50}]},
        )
        assert created.status_code == 200
        points = created.json()["points"]
        assert points[0]["x"] == 0 and points[1]["x"] == 100, points


# --- the ruler ----------------------------------------------------------------


async def test_a_ruler_reports_no_metres_until_the_sheet_is_calibrated():
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)

        measured = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
            headers=headers,
            json={"kind": "measure", "points": [{"x": 0, "y": 0}, {"x": 30, "y": 40}]},
        )
        assert measured.status_code == 200
        assert measured.json()["measured_m"] is None, (
            "an uncalibrated sheet must not invent a length"
        )


async def test_calibration_makes_the_ruler_report_metres():
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)

        # A segment 10% of the sheet diagonal is 2 m.
        calibrated = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/calibrate",
            headers=headers,
            json={"ref_pct": 10, "ref_m": 2},
        )
        assert calibrated.status_code == 200, calibrated.text

        # 3-4-5 triangle: this segment is exactly 50% of the diagonal → 10 m.
        measured = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
            headers=headers,
            json={"kind": "measure", "points": [{"x": 0, "y": 0}, {"x": 30, "y": 40}]},
        )
        assert measured.status_code == 200
        assert measured.json()["measured_m"] == pytest.approx(10.0, abs=0.01)


async def test_recalibration_does_not_rewrite_a_measurement_already_taken():
    """It reports the disagreement instead, so nobody acts on a changed number."""
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)

        await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/calibrate",
            headers=headers,
            json={"ref_pct": 10, "ref_m": 2},
        )
        measured = (
            await client.post(
                f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
                headers=headers,
                json={"kind": "measure", "points": [{"x": 0, "y": 0}, {"x": 30, "y": 40}]},
            )
        ).json()
        assert measured["measured_m"] == pytest.approx(10.0, abs=0.01)

        again = await client.post(
            f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/calibrate",
            headers=headers,
            json={"ref_pct": 10, "ref_m": 4},
        )
        assert again.status_code == 200
        restated = again.json()["restated"]
        assert len(restated) == 1
        assert restated[0]["id"] == measured["id"]
        assert restated[0]["stored_m"] == pytest.approx(10.0, abs=0.01)
        assert restated[0]["now_m"] == pytest.approx(20.0, abs=0.01)

        stored = (
            await client.get(
                f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations",
                headers=headers,
            )
        ).json()["items"][0]
        assert stored["measured_m"] == pytest.approx(10.0, abs=0.01), (
            "the stored measurement must not change under the reader"
        )


# --- the eraser ---------------------------------------------------------------


async def test_erasing_hides_the_mark_but_keeps_it():
    async with _client() as client:
        _user, headers, project_id = await _context(client)
        plan_id = await _plan(client, headers, project_id)
        base = f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations"

        created = (
            await client.post(base, headers=headers, json={"kind": "line", "points": [{"x": 1, "y": 1}, {"x": 9, "y": 9}]})
        ).json()

        removed = await client.delete(f"{base}/{created['id']}", headers=headers)
        assert removed.status_code == 200
        assert removed.json() == {"ok": True, "removed": True, "replayed": False}

        live = (await client.get(base, headers=headers)).json()["items"]
        assert live == []

        history = (
            await client.get(f"{base}?include_deleted=true", headers=headers)
        ).json()["items"]
        assert len(history) == 1
        assert history[0]["deleted_at"] is not None

        # A retried delete is a replay, not a second removal.
        twice = await client.delete(f"{base}/{created['id']}", headers=headers)
        assert twice.status_code == 200
        assert twice.json()["replayed"] is True


# --- whose remark it is -------------------------------------------------------


async def test_another_authors_remark_cannot_be_edited_in_place():
    async with _client() as client:
        _author, author_headers, project_id = await _context(client, role="contractor")
        plan_id = await _plan(client, author_headers, project_id)
        base = f"/api/v1/projects/{project_id}/floor-plans/{plan_id}/annotations"

        created = (
            await client.post(
                base,
                headers=author_headers,
                json={"kind": "note", "points": [{"x": 5, "y": 5}], "text": "Шов кривой"},
            )
        ).json()

        customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        other_headers = {"X-User-Id": customer["id"]}

        edited = await client.patch(
            f"{base}/{created['id']}", headers=other_headers, json={"text": "Всё хорошо"}
        )
        assert edited.status_code == 403
        assert "annotation_author_only" in edited.text

        unchanged = (await client.get(base, headers=author_headers)).json()["items"][0]
        assert unchanged["text"] == "Шов кривой"


# --- scoping ------------------------------------------------------------------


async def test_a_sheet_from_another_project_is_not_found():
    """Both projects belong to the requester, so a refusal can only be scoping.

    Using two different owners would prove nothing: `require_project` would
    refuse first, for access rather than for the sheet not belonging here.
    """
    async with _client() as client:
        _user, headers, project_id = await _context(client, role="customer")
        plan_id = await _plan(client, headers, project_id)

        other = await client.post(
            "/api/v1/projects",
            headers=headers,
            json={
                "name": "Другой объект",
                "rooms": [{"name": "Комната", "length_m": 3, "width_m": 3}],
            },
        )
        assert other.status_code in (200, 201), other.text
        other_id = other.json()["id"]

        listed = await client.get(
            f"/api/v1/projects/{other_id}/floor-plans/{plan_id}/annotations",
            headers=headers,
        )
        assert listed.status_code == 404, (
            "a sheet must not be reachable through another project's id"
        )
