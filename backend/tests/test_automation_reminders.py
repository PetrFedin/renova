"""Integration: automation reminder tick — overdue stages + waste pickup."""
from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.timeutil import utc_now
from app.db.session import init_db
from app.db import session as sess
from app.main import app
from app.models.entities import AppNotification, Stage, WasteOrder, WasteOrderStatus
from app.services.automation_reminders_worker import run_automation_reminder_tick, scan_waste_reminders
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "automation_reminders.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setenv("AUTOMATION_REMINDERS_ENABLED", "0")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    config.settings.automation_reminders_enabled = False
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _demo_project(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust = {"X-User-Id": cust["id"]}
    h_cont = {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
    return pid, cust["id"], h_cust, h_cont


async def test_waste_reminder_on_tick():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, h_cust, _ = await _demo_project(client)
        tomorrow = date.today() + timedelta(days=1)
        async with sess.SessionLocal() as db:
            w = WasteOrder(
                project_id=pid,
                volume_m3=2.5,
                scheduled_date=tomorrow,
                status=WasteOrderStatus.scheduled,
            )
            db.add(w)
            await db.commit()

        result = await run_automation_reminder_tick(on_date=date.today())
        assert result["waste_sent"] >= 1

        async with sess.SessionLocal() as db:
            rows = (
                await db.execute(
                    select(AppNotification).where(
                        AppNotification.user_id == cust_id,
                        AppNotification.notification_type == "waste_reminder",
                    )
                )
            ).scalars().all()
            assert len(rows) >= 1


async def test_overdue_stage_reminder_on_tick():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, h_cust, h_cont = await _demo_project(client)
        async with sess.SessionLocal() as db:
            stages = (
                await db.execute(select(Stage).where(Stage.project_id == pid))
            ).scalars().all()
            overdue = stages[0]
            from app.models.entities import StageStatus
            overdue.status = StageStatus.active
            overdue.planned_end = date.today() - timedelta(days=3)
            await db.commit()

        result = await run_automation_reminder_tick(on_date=date.today())
        assert result["project_actions"] >= 1

        async with sess.SessionLocal() as db:
            rows = (
                await db.execute(
                    select(AppNotification).where(
                        AppNotification.project_id == pid,
                        AppNotification.notification_type == "deadline",
                    )
                )
            ).scalars().all()
            assert len(rows) >= 1


async def test_waste_reminders_manual_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, _, h_cust, _ = await _demo_project(client)
        # Ручка не принимает дату и берёт её у `utc_now()`. Локальная
        # `date.today()` расходится с UTC в те часы, когда местная дата уже
        # сменилась, а UTC ещё нет: в MSK это каждую ночь с 00:00 до 03:00, и
        # тест падал у всех веток разом. Заказ ставим по тем же часам, по
        # которым ручка ищет — иначе проверяется рассинхрон часов, а не вывоз.
        tomorrow = utc_now().date() + timedelta(days=1)
        async with sess.SessionLocal() as db:
            db.add(
                WasteOrder(
                    project_id=pid,
                    volume_m3=1.0,
                    scheduled_date=tomorrow,
                    status=WasteOrderStatus.scheduled,
                )
            )
            await db.commit()
        r = await client.post("/api/v1/notifications/waste-reminders/check", headers=h_cust)
        assert r.status_code == 200
        assert r.json()["sent"] >= 1


async def test_waste_reminder_day_comes_from_the_same_clock_as_the_endpoint():
    """Ручка и сканер обязаны считать «завтра» одними часами.

    Сейчас это UTC. Правильный ли это выбор для пользователя в MSK — вопрос
    открытый: в ночные часы местное «завтра» и UTC-«завтра» — разные дни, и
    уведомление «Завтра вывоз мусора» уезжает на сутки. Часового пояса бизнеса
    в бэкенде пока нет вовсе (`app/core/timeutil.py` знает только UTC), поэтому
    здесь закреплено текущее поведение: смена часов станет видимой правкой, а
    не тихим изменением смысла уведомления.
    """
    import inspect

    from app.services import automation_reminders_worker as worker

    source = inspect.getsource(worker.scan_waste_reminders)
    assert "scan_date = on_date or utc_now().date()" in source
    assert "date.today()" not in source, (
        "сканер перешёл на локальные часы — решение о часовом поясе принято, "
        "и его нужно провести по всем датам, а не только здесь"
    )
