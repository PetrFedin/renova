"""Кнопка «Рассчитать материалы» считает, а не падает.

`POST /projects/{id}/rooms/{id}/calc-materials` читал у комнаты поля
`floor_sq_m`, `wall_sq_m` и `perimeter_m`. Таких полей у `Room` нет — это
производные величины, у модели есть только длина, ширина, высота и площадь
проёмов. Обработчик падал всегда, при любых данных:

    AttributeError: 'Room' object has no attribute 'floor_sq_m'

На экране комнаты это выглядело как кнопка, которая ничего не делает: свой
обработчик ошибок у неё тоже отсутствует.

Метрики теперь считает `calc_room_metrics` — та же функция, которой пользуются
список комнат и смета. Вторая формула означала бы вторую правду о площади.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.calc.estimate import calc_room_metrics
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "calc.db"
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


async def _room(client, headers, *, length: float, width: float, height: float):
    created = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "name": "Объект расчёта",
            "rooms": [{"name": "Кухня", "length_m": length, "width_m": width, "height_m": height}],
        },
    )
    assert created.status_code in (200, 201), created.text
    project_id = created.json()["id"]
    rooms = (await client.get(f"/api/v1/projects/{project_id}/rooms", headers=headers)).json()
    return project_id, rooms[0]


async def test_the_calculator_answers_instead_of_failing():
    """Именно это падало с 500 при любых данных."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, room = await _room(client, headers, length=4, width=3, height=2.7)

        answer = await client.post(
            f"/api/v1/projects/{project_id}/rooms/{room['id']}/calc-materials",
            headers=headers,
        )

        assert answer.status_code == 200, answer.text
        body = answer.json()
        assert body["room_id"] == room["id"]
        assert body["items"], "расчёт вернулся пустым — считать по размерам комнаты было нечего"
        for item in body["items"]:
            assert item["qty"] > 0, f"нулевое количество: {item}"
            assert item["unit"], f"единица измерения не указана: {item}"


async def test_the_numbers_match_the_rooms_own_metrics():
    """Страховка от «лишь бы не падало»: площадь должна быть той же самой.

    Список комнат и смета считают метрики через `calc_room_metrics`. Если бы
    расчёт материалов завёл свою формулу, пользователь видел бы на одном
    экране одну площадь, а на другом — другую.
    """
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, room = await _room(client, headers, length=5, width=4, height=3)

        expected = calc_room_metrics(5, 4, 3, room["openings_sq_m"])
        assert room["floor_sq_m"] == pytest.approx(expected.floor_sq_m)
        assert room["wall_sq_m"] == pytest.approx(expected.wall_sq_m)

        items = (
            await client.post(
                f"/api/v1/projects/{project_id}/rooms/{room['id']}/calc-materials",
                headers=headers,
            )
        ).json()["items"]

        # Напольные материалы считаются от площади пола: количество обязано
        # расти вместе с ней, а не жить своей жизнью.
        floor_items = [i for i in items if i["unit"] == "м²" and i["qty"] >= expected.floor_sq_m]
        assert floor_items, (
            f"ни одна позиция не опирается на площадь пола {expected.floor_sq_m}: {items}"
        )


async def test_a_bigger_room_needs_more():
    """Ещё одна страховка: расчёт зависит от размеров, а не выдаёт константу."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}

        small_project, small = await _room(client, headers, length=2, width=2, height=2.7)
        big_project, big = await _room(client, headers, length=6, width=5, height=2.7)

        def total(project_id: str, room_id: str):
            return client.post(
                f"/api/v1/projects/{project_id}/rooms/{room_id}/calc-materials",
                headers=headers,
            )

        small_items = (await total(small_project, small["id"])).json()["items"]
        big_items = (await total(big_project, big["id"])).json()["items"]

        small_sum = sum(i["qty"] for i in small_items)
        big_sum = sum(i["qty"] for i in big_items)
        assert big_sum > small_sum, (
            f"комната 6×5 требует не больше, чем 2×2: {big_sum} против {small_sum}"
        )


async def test_a_room_from_another_project_is_refused():
    """Страховка по доступу — заодно проверяем, что 404 не превратился в 500."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, _room_a = await _room(client, headers, length=4, width=3, height=2.7)
        _other_project, room_b = await _room(client, headers, length=4, width=3, height=2.7)

        refused = await client.post(
            f"/api/v1/projects/{project_id}/rooms/{room_b['id']}/calc-materials",
            headers=headers,
        )
        assert refused.status_code == 404, refused.text
