"""Повтор после потери ответа не должен создавать второй наряд.

Вторая и третья части блокера #316: задача из сообщения чата и прямое
создание наряда. Оба маршрута не принимали ключ идемпотентности, поэтому
повторная отправка того же запроса плодила наряды.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import ChatMessage, WorkOrder

from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def stand(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/wo_idem.db"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    import sqlalchemy.ext.asyncio as sa

    sess.engine = sa.create_async_engine(url, echo=False)
    sess.SessionLocal = sa.async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, sess


async def context(client) -> tuple[str, str, str, str, str]:
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    contractor = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    headers = {"X-User-Id": customer["id"]}
    project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]
    threads = (await client.get(f"/api/v1/projects/{project_id}/chats", headers=headers)).json()
    thread_id = threads[0]["id"]
    sent = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/messages",
        headers=headers,
        json={"text": "Подоконник не закреплён", "client_request_id": "seed-msg-000001"},
    )
    assert sent.status_code == 200, sent.text
    return customer["id"], contractor["id"], project_id, thread_id, sent.json()["id"]


async def count_rows(sess, model, **filters) -> int:
    async with sess.SessionLocal() as db:
        query = select(func.count()).select_from(model)
        for column, value in filters.items():
            query = query.where(getattr(model, column) == value)
        return int(await db.scalar(query))


async def test_repeated_task_from_message_makes_one_work_order(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id, message_id = await context(client)
    before = await count_rows(sess, WorkOrder, project_id=project_id)

    body = {
        "title": "Закрепить подоконник",
        "work_type": "general",
        "client_request_id": "chat-task-retry-0001",
    }
    first = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/task",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/task",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert second.status_code == 200, second.text

    after = await count_rows(sess, WorkOrder, project_id=project_id)
    assert after - before == 1, f"повтор создал ещё один наряд: было {before}, стало {after}"
    assert first.json()["id"] == second.json()["id"], "повтор должен вернуть то же сообщение"


async def test_repeated_task_does_not_duplicate_the_chat_message(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id, message_id = await context(client)
    before = await count_rows(sess, ChatMessage, thread_id=thread_id)

    body = {
        "title": "Закрепить подоконник",
        "work_type": "general",
        "client_request_id": "chat-task-retry-0002",
    }
    for _ in range(3):
        await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/task",
            headers={"X-User-Id": contractor_id},
            json=body,
        )

    after = await count_rows(sess, ChatMessage, thread_id=thread_id)
    assert after - before == 1, f"в переписке появилось {after - before} сообщений вместо одного"


async def test_two_different_tasks_are_still_two(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id, message_id = await context(client)
    before = await count_rows(sess, WorkOrder, project_id=project_id)

    for index in (1, 2):
        response = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/task",
            headers={"X-User-Id": contractor_id},
            json={
                "title": f"Задача {index}",
                "work_type": "general",
                "client_request_id": f"chat-task-distinct-{index}",
            },
        )
        assert response.status_code == 200, response.text

    after = await count_rows(sess, WorkOrder, project_id=project_id)
    assert after - before == 2


async def test_task_without_a_key_still_works(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id, message_id = await context(client)
    before = await count_rows(sess, WorkOrder, project_id=project_id)

    response = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/task",
        headers={"X-User-Id": contractor_id},
        json={"title": "Без ключа", "work_type": "general"},
    )

    assert response.status_code == 200, response.text
    assert await count_rows(sess, WorkOrder, project_id=project_id) - before == 1


async def test_repeated_direct_work_order_makes_one(stand):
    """Прямое создание наряда — третья часть #316."""
    client, sess = stand
    _, contractor_id, project_id, _, _ = await context(client)
    before = await count_rows(sess, WorkOrder, project_id=project_id)

    body = {
        "title": "Штробление под электрику",
        "work_type": "electrical",
        "client_request_id": "work-order-retry-0001",
    }
    first = await client.post(
        f"/api/v1/projects/{project_id}/work-orders",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert first.status_code in (200, 201), first.text

    second = await client.post(
        f"/api/v1/projects/{project_id}/work-orders",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert second.status_code in (200, 201), second.text

    after = await count_rows(sess, WorkOrder, project_id=project_id)
    assert after - before == 1, f"повтор создал ещё один наряд: было {before}, стало {after}"
    assert first.json()["id"] == second.json()["id"]
