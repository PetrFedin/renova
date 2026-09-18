"""В бригаду входят по согласию, и из неё можно выйти.

`POST /teams/invite` создавал членство сразу, по одному номеру телефона, без
всякого участия приглашаемого. Само по себе это уже неверно, но цена видна на
технадзоре.

`is_active_supervisor` → `_assert_independent` → `project_team_membership`:
проверяющий, состоящий в бригаде проверяемого подрядчика, независимым не
считается и теряет доступ к проекту. Правило верное и намеренно fail-closed.
Но его вход был подконтролен ровно той стороне, которую оно ограничивает:

    подрядчик знает телефон технадзора (они встречаются на объекте)
      → POST /teams/invite {phone}
      → членство создано молча
      → _assert_independent падает
      → технадзор теряет доступ к проекту
      → маршрута на удаление участника нет ни у кого

Одним запросом подрядчик убирал человека, нанятого проверять его работу, — и
отменить это было нельзя. Экран при этом уже писал «приглашение отправлено».

Теперь по телефону выдаётся токен, привязанный к адресату, членство создаёт
сам приглашённый через `/teams/join`, а выйти можно через `/teams/leave`.
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
    db_path = tmp_path / "teams.db"
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


async def _contractor(client, phone: str) -> dict:
    """Отдельный исполнитель со своим телефоном.

    `/auth/demo` отдаёт одного и того же демо-исполнителя на каждую роль, а
    здесь нужны разные люди — весь смысл в том, что один зовёт другого.
    """
    from app.db import session as sess
    from app.models.entities import User, UserRole

    async with sess.SessionLocal() as db:
        user = User(phone=phone, role=UserRole.contractor)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id
    return {"id": user_id, "headers": {"X-User-Id": user_id}, "phone": phone}


async def _members(client, actor) -> list[str]:
    team = (await client.get("/api/v1/teams/me", headers=actor["headers"])).json()
    if not team:
        return []
    return [m["user_id"] for m in (team.get("members") or [])]


async def test_a_phone_invitation_does_not_create_membership_by_itself():
    """Ядро: подрядчик не может втянуть чужого человека к себе в бригаду."""
    async with _client() as client:
        owner = await _contractor(client, "+79001110001")
        target = await _contractor(client, "+79001110002")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        invited = await client.post(
            "/api/v1/teams/invite",
            headers=owner["headers"],
            json={"phone": target["phone"]},
        )
        assert invited.status_code == 200, invited.text
        assert invited.json().get("ok") is True

        assert target["id"] not in await _members(client, owner), (
            "человека включили в бригаду без его согласия"
        )


async def test_the_invitation_works_once_the_person_accepts_it():
    """Страховка от «сломать приглашения»: путь с согласием обязан работать."""
    async with _client() as client:
        owner = await _contractor(client, "+79002220001")
        target = await _contractor(client, "+79002220002")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post(
                "/api/v1/teams/invite",
                headers=owner["headers"],
                json={"phone": target["phone"]},
            )
        ).json()["token"]

        joined = await client.post(
            "/api/v1/teams/join", headers=target["headers"], json={"token": token}
        )
        assert joined.status_code == 200, joined.text
        assert joined.json().get("ok") is True
        assert target["id"] in await _members(client, owner)


async def test_a_personal_invitation_cannot_be_used_by_someone_else():
    """Токен, выписанный на человека, не пересылается дальше."""
    async with _client() as client:
        owner = await _contractor(client, "+79003330001")
        target = await _contractor(client, "+79003330002")
        stranger = await _contractor(client, "+79003330003")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post(
                "/api/v1/teams/invite",
                headers=owner["headers"],
                json={"phone": target["phone"]},
            )
        ).json()["token"]

        refused = await client.post(
            "/api/v1/teams/join", headers=stranger["headers"], json={"token": token}
        )
        assert refused.json().get("ok") is not True
        assert stranger["id"] not in await _members(client, owner)


async def test_an_impersonal_link_still_works_for_anyone():
    """Ссылка и QR обезличены по назначению — привязка их не должна задеть."""
    async with _client() as client:
        owner = await _contractor(client, "+79004440001")
        joiner = await _contractor(client, "+79004440002")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post("/api/v1/teams/invite-link", headers=owner["headers"], json={})
        ).json()["token"]

        joined = await client.post(
            "/api/v1/teams/join", headers=joiner["headers"], json={"token": token}
        )
        assert joined.json().get("ok") is True
        assert joiner["id"] in await _members(client, owner)


async def test_a_member_can_leave_the_brigade():
    """Выхода не было вовсе — правило независимости было ловушкой."""
    async with _client() as client:
        owner = await _contractor(client, "+79005550001")
        member = await _contractor(client, "+79005550002")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post("/api/v1/teams/invite-link", headers=owner["headers"], json={})
        ).json()["token"]
        await client.post(
            "/api/v1/teams/join", headers=member["headers"], json={"token": token}
        )
        assert member["id"] in await _members(client, owner)

        left = await client.post("/api/v1/teams/leave", headers=member["headers"])
        assert left.status_code == 200, left.text
        assert left.json().get("ok") is True
        assert member["id"] not in await _members(client, owner)


async def test_the_owner_can_remove_a_member_but_not_themselves():
    async with _client() as client:
        owner = await _contractor(client, "+79006660001")
        member = await _contractor(client, "+79006660002")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post("/api/v1/teams/invite-link", headers=owner["headers"], json={})
        ).json()["token"]
        await client.post(
            "/api/v1/teams/join", headers=member["headers"], json={"token": token}
        )

        removed = await client.request(
            "DELETE",
            "/api/v1/teams/member",
            headers=owner["headers"],
            json={"user_id": member["id"]},
        )
        assert removed.status_code == 200, removed.text
        assert member["id"] not in await _members(client, owner)

        # Владелец, исключивший себя, оставил бы бригаду без хозяина.
        self_removal = await client.request(
            "DELETE",
            "/api/v1/teams/member",
            headers=owner["headers"],
            json={"user_id": owner["id"]},
        )
        assert self_removal.status_code == 403


async def test_a_stranger_cannot_remove_someone_from_a_team_they_do_not_own():
    """Страховка от «удалять может кто угодно»."""
    async with _client() as client:
        owner = await _contractor(client, "+79007770001")
        member = await _contractor(client, "+79007770002")
        stranger = await _contractor(client, "+79007770003")

        await client.post(
            "/api/v1/teams", headers=owner["headers"], json={"name": "Бригада"}
        )
        token = (
            await client.post("/api/v1/teams/invite-link", headers=owner["headers"], json={})
        ).json()["token"]
        await client.post(
            "/api/v1/teams/join", headers=member["headers"], json={"token": token}
        )

        refused = await client.request(
            "DELETE",
            "/api/v1/teams/member",
            headers=stranger["headers"],
            json={"user_id": member["id"]},
        )
        assert refused.status_code == 403
        assert member["id"] in await _members(client, owner)
