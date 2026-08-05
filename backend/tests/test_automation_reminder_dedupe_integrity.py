"""Regression coverage for persistent periodic-reminder deduplication."""
from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import AppNotification, DomainOutbox, Stage, StageStatus, WasteOrder, WasteOrderStatus
from app.services.automation_reminder_outbox import reminder_outbox_id
from app.services.automation_reminders_worker import run_automation_reminder_tick
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "automation_reminder_dedupe.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("AUTOMATION_REMINDERS_ENABLED", "0")
    from app.core import config

    config.settings.database_url = database_url
    config.settings.automation_reminders_enabled = False
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _project_with_assignment(client: AsyncClient):
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    contractor = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    customer_headers = {"X-User-Id": customer["id"]}
    contractor_headers = {"X-User-Id": contractor["id"]}
    project_id = (await client.get("/api/v1/projects", headers=customer_headers)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{project_id}/assign", headers=contractor_headers)
    return project_id, customer["id"], contractor["id"]


async def test_same_day_tick_creates_one_overdue_and_one_waste_notification():
    today = date(2026, 8, 5)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        project_id, customer_id, contractor_id = await _project_with_assignment(client)

    async with sess.SessionLocal() as db:
        stage = (
            await db.execute(select(Stage).where(Stage.project_id == project_id))
        ).scalars().first()
        assert stage is not None
        stage.status = StageStatus.active
        stage.planned_end = today - timedelta(days=1)
        waste = WasteOrder(
            project_id=project_id,
            volume_m3=2.0,
            scheduled_date=today + timedelta(days=1),
            status=WasteOrderStatus.scheduled,
        )
        db.add(waste)
        await db.commit()
        waste_id = waste.id
        stage_id = stage.id

    first = await run_automation_reminder_tick(on_date=today)
    second = await run_automation_reminder_tick(on_date=today)

    assert first["reminders_enqueued"] >= 2
    assert second["reminders_enqueued"] == 0

    overdue_key = f"schedule-overdue:{stage_id}:{contractor_id}:{today.isoformat()}"
    waste_key = f"waste:{waste_id}:{customer_id}:{(today + timedelta(days=1)).isoformat()}"
    async with sess.SessionLocal() as db:
        assert await db.get(DomainOutbox, reminder_outbox_id(overdue_key)) is not None
        assert await db.get(DomainOutbox, reminder_outbox_id(waste_key)) is not None
        deadline_count = await db.scalar(
            select(func.count()).select_from(AppNotification).where(
                AppNotification.project_id == project_id,
                AppNotification.notification_type == "deadline",
            )
        )
        waste_count = await db.scalar(
            select(func.count()).select_from(AppNotification).where(
                AppNotification.project_id == project_id,
                AppNotification.notification_type == "waste_reminder",
            )
        )
        assert deadline_count == 1
        assert waste_count == 1


async def test_next_day_gets_a_new_overdue_occurrence():
    today = date(2026, 8, 5)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        project_id, _, _ = await _project_with_assignment(client)

    async with sess.SessionLocal() as db:
        stage = (
            await db.execute(select(Stage).where(Stage.project_id == project_id))
        ).scalars().first()
        assert stage is not None
        stage.status = StageStatus.active
        stage.planned_end = today - timedelta(days=2)
        await db.commit()

    first = await run_automation_reminder_tick(on_date=today)
    next_day = await run_automation_reminder_tick(on_date=today + timedelta(days=1))
    assert first["project_actions"] >= 1
    assert next_day["project_actions"] >= 1

    async with sess.SessionLocal() as db:
        count = await db.scalar(
            select(func.count()).select_from(AppNotification).where(
                AppNotification.project_id == project_id,
                AppNotification.notification_type == "deadline",
            )
        )
        assert count == 2
