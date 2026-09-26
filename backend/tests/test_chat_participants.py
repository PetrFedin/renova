"""Приглашённый в чат может писать, а убрать его есть чем.

Приглашение в чат объекта работало наполовину.

Писать приглашённый не мог никогда. `router.py` удаляет `POST /messages` из
`chats.router` и ставит вместо него обработчик из
`technical_supervision_chat.py`, а тот звал `require_chat_access` без
`allow_participant=True`. Тред открывался, отметка о прочтении ставилась,
состояние менялось — а отправка отвечала 403 «Нет доступа». Рабочий
обработчик с `allow_participant=True` при этом лежал в `chats.py` мёртвым
кодом, недостижимым из роутера.

Убрать участника было нечем: маршрута не существовало. Приглашённый читал всю
переписку, включая счета, пока существует тред.

И приглашение проходило молча: исполнитель добавлял постороннего, заказчик
нигде этого не видел.
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
    db_path = tmp_path / "chat.db"
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
    body = (
        await client.post(
            "/api/v1/auth/register",
            json={"phone": phone, "role": role, "full_name": f"{role}-{phone[-4:]}"},
        )
    ).json()
    return {"id": body["id"], "headers": {"X-User-Id": body["id"]}, "code": body.get("profile_code")}


async def _stand(client):
    owner = await _user(client, "customer", "+79951110001")
    contractor = await _user(client, "contractor", "+79951110002")
    guest = await _user(client, "contractor", "+79951110003")

    project_id = (
        await client.post(
            "/api/v1/projects",
            headers=owner["headers"],
            json={"name": "Объект", "rooms": [{"name": "Кухня", "length_m": 4, "width_m": 3}]},
        )
    ).json()["id"]
    await client.post(
        f"/api/v1/projects/{project_id}/contractor",
        headers=owner["headers"],
        json={"contractor_id": contractor["id"]},
    )

    created = await client.post(
        f"/api/v1/projects/{project_id}/chats",
        headers=owner["headers"],
        json={"title": "Общий чат"},
    )
    assert created.status_code == 200, created.text
    return owner, contractor, guest, project_id, created.json()["id"]


async def _profile_code(client, person) -> str:
    me = (await client.get("/api/v1/auth/me", headers=person["headers"])).json()
    code = me.get("profile_code")
    assert code, f"у пользователя нет кода профиля: {me}"
    return code


async def test_an_invited_participant_can_write():
    """Главное: приглашение, после которого нельзя писать, — не приглашение."""
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)
        code = await _profile_code(client, guest)

        invited = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invite",
            headers=contractor["headers"],
            json={"profile_code": code},
        )
        assert invited.status_code == 200, invited.text

        sent = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/messages",
            headers=guest["headers"],
            json={"text": "Здравствуйте", "client_request_id": "guest-msg-1"},
        )
        assert sent.status_code == 200, (
            f"приглашённый участник не может писать: {sent.status_code} {sent.text}"
        )


async def test_a_stranger_still_cannot_write():
    """Страховка: allow_participant не должен впустить кого угодно."""
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)

        refused = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/messages",
            headers=guest["headers"],
            json={"text": "Я мимо проходил", "client_request_id": "stranger-1"},
        )
        assert refused.status_code == 403, (
            f"посторонний пишет в чужой чат: {refused.status_code}"
        )


async def test_the_owner_can_remove_a_participant():
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)
        code = await _profile_code(client, guest)
        await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invite",
            headers=contractor["headers"],
            json={"profile_code": code},
        )

        removed = await client.delete(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/participants/{guest['id']}",
            headers=owner["headers"],
        )
        assert removed.status_code == 200, removed.text

        # ...и писать он больше не может.
        after = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/messages",
            headers=guest["headers"],
            json={"text": "Снова я", "client_request_id": "after-removal"},
        )
        assert after.status_code == 403, "убранный участник продолжает писать"


async def test_a_participant_can_leave_himself():
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)
        code = await _profile_code(client, guest)
        await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invite",
            headers=contractor["headers"],
            json={"profile_code": code},
        )

        left = await client.delete(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/participants/{guest['id']}",
            headers=guest["headers"],
        )
        assert left.status_code == 200, left.text


async def test_the_inviter_cannot_remove_the_owner():
    """Иначе исполнитель выставил бы заказчика из чата его же объекта."""
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)

        refused = await client.delete(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/participants/{owner['id']}",
            headers=contractor["headers"],
        )
        assert refused.status_code in (403, 404), (
            f"исполнитель убрал владельца объекта из чата: {refused.status_code}"
        )


async def test_the_owner_is_told_about_a_new_participant():
    """Посторонний не должен появляться в чате объекта молча."""
    async with _client() as client:
        owner, contractor, guest, project_id, thread_id = await _stand(client)
        code = await _profile_code(client, guest)

        before = (await client.get("/api/v1/notifications", headers=owner["headers"])).json()
        before_count = len(before if isinstance(before, list) else before.get("items", []))

        await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invite",
            headers=contractor["headers"],
            json={"profile_code": code},
        )

        after = (await client.get("/api/v1/notifications", headers=owner["headers"])).json()
        items = after if isinstance(after, list) else after.get("items", [])
        assert len(items) > before_count, "владелец объекта не узнал о новом участнике чата"
        assert any("участник" in (item.get("title") or "").lower() for item in items), (
            f"уведомление не про участника: {[i.get('title') for i in items[:3]]}"
        )
