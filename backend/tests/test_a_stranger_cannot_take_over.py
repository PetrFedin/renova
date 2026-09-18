"""Посторонний не захватывает ни объект, ни учётную запись.

Воспроизведено на живом стенде до правки — цепочка из трёх звеньев, каждое
из которых само по себе дыра.

1. Любой пользователь с ролью исполнителя, зная **только UUID объекта**,
   делал себя его подрядчиком:

       GET  /projects/{id}          403   — до
       POST /projects/{id}/assign   200
       GET  /projects/{id}          200   — после, вместе со сметой и бюджетом

   Маршрут не проверял доступ вовсе. Клиент при этом зовёт assign только
   после успешного чтения проекта, то есть для законного пути проверка
   ничего не меняет.

2. Исполнитель объекта просил ссылку на портал, и токен выписывался на
   `customer_id` — то есть он получал учётные данные заказчика:

       POST /auth/portal/session → JWT, аутентифицирующий как заказчик
       GET  /auth/me             → роль и телефон заказчика
       GET  /projects/{другой}   → 403 по X-User-Id, 200 по Bearer
       POST /projects/{другой}/trash → 200

3. Исполнитель переписывал профиль объекта заказчика: название, адрес, сроки,
   ставку НДС и личный потолок бюджета — без уведомления.

Вместе: аноним → регистрация исполнителем → assign на чужой UUID →
portal-link → полная учётная запись заказчика.
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
    db_path = tmp_path / "takeover.db"
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


async def _user(client, role: str, phone: str) -> dict:
    created = await client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "role": role, "full_name": f"{role} {phone[-4:]}"},
    )
    assert created.status_code in (200, 201), created.text
    body = created.json()
    return {"id": body["id"], "headers": {"X-User-Id": body["id"]}}


async def _project(client, owner, name: str) -> str:
    created = await client.post(
        "/api/v1/projects",
        headers=owner["headers"],
        json={"name": name, "rooms": [{"name": "Кухня", "length_m": 4, "width_m": 3}]},
    )
    assert created.status_code in (200, 201), created.text
    return created.json()["id"]


# --- звено 1: самозахват объекта ----------------------------------------------


async def test_a_stranger_cannot_make_himself_the_contractor():
    """Знание UUID не даёт права на объект."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79991110001")
        stranger = await _user(client, "contractor", "+79991110002")
        project_id = await _project(client, owner, "Приватный объект")

        before = await client.get(f"/api/v1/projects/{project_id}", headers=stranger["headers"])
        assert before.status_code == 403, "стенд собран неверно: доступ есть до захвата"

        claim = await client.post(
            f"/api/v1/projects/{project_id}/assign", headers=stranger["headers"], json={}
        )
        assert claim.status_code == 403, (
            f"посторонний назначил себя подрядчиком чужого объекта: {claim.status_code}"
        )

        after = await client.get(f"/api/v1/projects/{project_id}", headers=stranger["headers"])
        assert after.status_code == 403, "доступ появился после отклонённого захвата"


async def test_the_owner_can_still_link_a_contractor():
    """Страховка: законный путь не сломан."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79992220001")
        contractor = await _user(client, "contractor", "+79992220002")
        project_id = await _project(client, owner, "Объект с подрядчиком")

        linked = await client.post(
            f"/api/v1/projects/{project_id}/contractor",
            headers=owner["headers"],
            json={"contractor_id": contractor["id"]},
        )
        assert linked.status_code == 200, linked.text

        seen = await client.get(f"/api/v1/projects/{project_id}", headers=contractor["headers"])
        assert seen.status_code == 200, "назначенный заказчиком подрядчик не видит объект"


async def test_an_assigned_contractor_can_still_reconcile_his_assignment():
    """Клиент зовёт assign при входе — для того, у кого доступ есть, он обязан работать."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79993330001")
        contractor = await _user(client, "contractor", "+79993330002")
        project_id = await _project(client, owner, "Объект")
        await client.post(
            f"/api/v1/projects/{project_id}/contractor",
            headers=owner["headers"],
            json={"contractor_id": contractor["id"]},
        )

        again = await client.post(
            f"/api/v1/projects/{project_id}/assign", headers=contractor["headers"], json={}
        )
        assert again.status_code == 200, (
            f"назначенный подрядчик не может подтвердить назначение: {again.text}"
        )


# --- звено 2: чужие учётные данные ---------------------------------------------


async def test_a_contractor_cannot_mint_a_customer_session():
    """Ссылка на портал — не способ получить учётные данные заказчика."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79994440001")
        contractor = await _user(client, "contractor", "+79994440002")
        project_id = await _project(client, owner, "Объект")
        await client.post(
            f"/api/v1/projects/{project_id}/contractor",
            headers=owner["headers"],
            json={"contractor_id": contractor["id"]},
        )

        refused = await client.post(
            f"/api/v1/projects/{project_id}/portal-link",
            headers=contractor["headers"],
            json={},
        )
        assert refused.status_code == 403, (
            f"исполнитель выписал ссылку на учётную запись заказчика: {refused.status_code}"
        )


async def test_the_owner_still_gets_a_portal_link():
    """Страховка: заказчик своей ссылки не лишился."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79995550001")
        project_id = await _project(client, owner, "Объект")

        link = await client.post(
            f"/api/v1/projects/{project_id}/portal-link", headers=owner["headers"], json={}
        )
        assert link.status_code == 200, link.text
        assert link.json()["token"], "ссылка выдана без токена"


# --- звено 3: профиль объекта ---------------------------------------------------


async def test_a_contractor_cannot_rewrite_the_project_profile():
    """Ставка НДС пересчитывает суммы, потолок бюджета — личное дело заказчика."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79996660001")
        contractor = await _user(client, "contractor", "+79996660002")
        project_id = await _project(client, owner, "Объект заказчика")
        await client.post(
            f"/api/v1/projects/{project_id}/contractor",
            headers=owner["headers"],
            json={"contractor_id": contractor["id"]},
        )

        refused = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=contractor["headers"],
            json={"name": "Переименовано исполнителем", "vat_rate": 20, "customer_budget": 1},
        )
        assert refused.status_code == 403, (
            f"исполнитель переписал профиль объекта: {refused.status_code}"
        )

        seen = (await client.get(f"/api/v1/projects/{project_id}", headers=owner["headers"])).json()
        assert seen["name"] == "Объект заказчика", "название всё-таки изменилось"
        assert seen["vat_rate"] != 20, "ставка НДС всё-таки изменилась"


async def test_the_owner_still_edits_his_own_project():
    """Страховка: владелец правит свой объект как и раньше."""
    async with _client() as client:
        owner = await _user(client, "customer", "+79997770001")
        project_id = await _project(client, owner, "Объект")

        changed = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=owner["headers"],
            json={"name": "Новое название", "vat_rate": 20},
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["name"] == "Новое название"
