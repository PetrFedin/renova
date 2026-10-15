from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.models.entities import User, UserRole
from app.services.providers import registry as provider_registry

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'npd_marketplace.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    config.settings.database_url = url
    monkeypatch.setattr(config.settings, "npd_status_provider_mode", "simulated")
    provider_registry.reset()
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        db.add_all([
            User(id="npd-customer", phone="+70000000101", role=UserRole.customer),
            User(id="npd-active", phone="+70000000102", role=UserRole.contractor),
            User(id="npd-inactive", phone="+70000000103", role=UserRole.contractor),
        ])
        await db.commit()
    yield
    provider_registry.reset()


def _h(user_id: str) -> dict[str, str]:
    return {"X-User-Id": user_id}


async def test_simulated_npd_status_drives_marketplace_admission_through_public_api():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        active = await client.post(
            "/api/v1/fns/verify-me",
            headers=_h("npd-active"),
            json={"inn": "770000000001"},
        )
        inactive = await client.post(
            "/api/v1/fns/verify-me",
            headers=_h("npd-inactive"),
            json={"inn": "770000000002"},
        )
        assert active.status_code == 200, active.text
        assert inactive.status_code == 200, inactive.text
        assert active.json()["is_npd"] is True
        assert active.json()["verified_live"] is False
        assert inactive.json()["is_npd"] is False

        created = await client.post(
            "/api/v1/job-leads",
            headers=_h("npd-customer"),
            json={
                "title": "NPD admission",
                "area_sqm": 45,
                "budget_hint": 1_000_000,
                "renovation_type": "cosmetic",
            },
        )
        assert created.status_code == 200, created.text
        lead_id = created.json()["id"]

        active_board = await client.get("/api/v1/job-leads?status=open", headers=_h("npd-active"))
        inactive_board = await client.get("/api/v1/job-leads?status=open", headers=_h("npd-inactive"))
        assert active_board.status_code == 200
        assert inactive_board.status_code == 200
        assert lead_id in {row["id"] for row in active_board.json()}
        assert lead_id not in {row["id"] for row in inactive_board.json()}

        bypass = await client.post(
            f"/api/v1/job-leads/{lead_id}/quote",
            headers=_h("npd-inactive"),
            json={"pre_estimate": 900_000},
        )
        assert bypass.status_code == 403
        assert bypass.json()["detail"]["code"] == "npd_active_required"

        quoted = await client.post(
            f"/api/v1/job-leads/{lead_id}/quote",
            headers=_h("npd-active"),
            json={"pre_estimate": 950_000},
        )
        assert quoted.status_code == 200, quoted.text


async def test_assigned_lead_remains_visible_if_npd_status_later_lapses():
    from app.db import session as sess
    from app.models.entities import JobLead, JobLeadStatus

    async with sess.SessionLocal() as db:
        lead = JobLead(
            customer_id="npd-customer",
            title="Existing relationship",
            area_sqm=50,
            renovation_type="cosmetic",
            budget_hint=1_100_000,
            assigned_contractor_id="npd-inactive",
            status=JobLeadStatus.quoted,
        )
        db.add(lead)
        await db.commit()
        lead_id = lead.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        rows = await client.get("/api/v1/job-leads?status=quoted", headers=_h("npd-inactive"))
        assert rows.status_code == 200
        assert lead_id in {row["id"] for row in rows.json()}
