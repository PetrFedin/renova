"""Прогресс проекта показывает, сколько сделано.

`GET /projects/{id}` отдавал `progress_percent` из колонки
`projects.progress_percent`. Эту колонку не пишет ничто, кроме демо-сидера
(`seed_demo.py:361`) — все остальные записи в коде относятся к другой модели,
`WorkScheduleItem`. На живом проекте она навсегда остаётся нулём.

Ответ противоречил сам себе:

    progress_percent в ответе : 0.0
    percent этапов в ответе   : [100.0, 0.0, 0.0, 0.0]

То есть карточка объекта показывала ноль независимо от того, сколько сделано.
`/dashboard` при этом считал честно, по `weighted_progress` — два маршрута
отвечали разное про одно и то же.

Гостевой портал читал ту же колонку: заказчик по ссылке видел ноль.
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
    db_path = tmp_path / "progress.db"
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


async def _project(client, headers):
    created = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": "Объект", "rooms": [{"name": "Кухня", "length_m": 4, "width_m": 3}]},
    )
    assert created.status_code in (200, 201), created.text
    return created.json()["id"]


async def _advance_first_stage(project_id: str, percent: float) -> None:
    from sqlalchemy import select

    from app.db import session as sess
    from app.models.entities import Stage

    async with sess.SessionLocal() as db:
        stages = (
            await db.execute(
                select(Stage).where(Stage.project_id == project_id).order_by(Stage.sort_order)
            )
        ).scalars().all()
        stages[0].percent_complete = percent
        await db.commit()


async def test_the_project_card_moves_when_work_is_done():
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id = await _project(client, headers)

        before = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        assert before["progress_percent"] == 0

        await _advance_first_stage(project_id, 100)

        after = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        assert after["progress_percent"] > 0, (
            "карточка объекта показывает ноль при выполненном этапе"
        )


async def test_the_card_and_the_dashboard_agree():
    """Два маршрута про одно и то же обязаны отвечать одинаково."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id = await _project(client, headers)
        await _advance_first_stage(project_id, 100)

        card = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        dashboard = (
            await client.get(f"/api/v1/projects/{project_id}/dashboard", headers=headers)
        ).json()

        assert card["progress_percent"] == pytest.approx(dashboard["progress_percent"]), (
            f"карточка {card['progress_percent']} против дашборда {dashboard['progress_percent']}"
        )


async def test_the_answer_does_not_contradict_its_own_stages():
    """Главная проверка: ответ не должен спорить сам с собой."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id = await _project(client, headers)
        await _advance_first_stage(project_id, 100)

        detail = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        done = [s for s in detail["stages"] if s["percent_complete"] >= 100]

        assert done, "стенд собран неверно: ни один этап не выполнен"
        assert detail["progress_percent"] > 0, (
            f"в ответе {len(done)} выполненных этапов, а прогресс {detail['progress_percent']}"
        )


async def test_an_untouched_project_still_reports_zero():
    """Страховка от «показывать что угодно, лишь бы не ноль»."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id = await _project(client, headers)

        detail = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        assert detail["progress_percent"] == 0


async def test_the_stale_column_is_no_longer_read_for_display():
    """Даже если в колонке лежит старое значение, показывается живое.

    Это и есть суть правки: колонку мы не трогаем и не удаляем, но перестаём
    ей верить.
    """
    from sqlalchemy import select

    from app.db import session as sess
    from app.models.entities import Project

    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id = await _project(client, headers)

        async with sess.SessionLocal() as db:
            project = (
                await db.execute(select(Project).where(Project.id == project_id))
            ).scalars().one()
            project.progress_percent = 77.0
            await db.commit()

        detail = (await client.get(f"/api/v1/projects/{project_id}", headers=headers)).json()
        assert detail["progress_percent"] == 0, (
            f"показано значение из мёртвой колонки: {detail['progress_percent']}"
        )
