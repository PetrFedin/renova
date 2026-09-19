"""Повтор после потери ответа не должен задваивать счёт и задачу из чата.

Обычный счёт (`POST /projects/{id}/payments`) принимает `client_request_id`
и на повтор отдаёт тот же платёж. Счёт из чата такого ключа не принимал —
если ответ до клиента не дошёл и он повторил отправку, появлялся второй
платёж и второе сообщение в переписке.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import ChatMessage, Payment
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def stand(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/chat_idem.db"
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


async def project_with_thread(client) -> tuple[str, str, str, str]:
    """Объект с назначенным исполнителем и чатом по нему."""
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    contractor = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    headers = {"X-User-Id": customer["id"]}
    project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]

    threads = await client.get(f"/api/v1/projects/{project_id}/chats", headers=headers)
    assert threads.status_code == 200, threads.text
    items = threads.json()
    assert items, "в демо-объекте ожидался чат"
    return customer["id"], contractor["id"], project_id, items[0]["id"]


async def count_rows(sess, model, **filters) -> int:
    async with sess.SessionLocal() as db:
        query = select(func.count()).select_from(model)
        for column, value in filters.items():
            query = query.where(getattr(model, column) == value)
        return int(await db.scalar(query))


async def test_repeated_chat_invoice_does_not_duplicate_the_payment(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id = await project_with_thread(client)
    before = await count_rows(sess, Payment, project_id=project_id)

    body = {
        "title": "Материалы на санузел",
        "amount": 48000,
        "payment_type": "material",
        "client_request_id": "chat-invoice-retry-0001",
    }
    first = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/invoice",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert first.status_code == 200, first.text

    # Клиент не дождался ответа и отправил то же самое ещё раз.
    second = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/invoice",
        headers={"X-User-Id": contractor_id},
        json=body,
    )
    assert second.status_code == 200, second.text

    after = await count_rows(sess, Payment, project_id=project_id)
    assert after - before == 1, f"повтор создал ещё один счёт: было {before}, стало {after}"
    assert first.json()["id"] == second.json()["id"], (
        "повтор должен вернуть то же сообщение, а не создать новое"
    )


async def test_repeated_chat_invoice_does_not_duplicate_the_message(stand):
    client, sess = stand
    _, contractor_id, project_id, thread_id = await project_with_thread(client)
    before = await count_rows(sess, ChatMessage, thread_id=thread_id)

    body = {
        "title": "Материалы на санузел",
        "amount": 48000,
        "payment_type": "material",
        "client_request_id": "chat-invoice-retry-0002",
    }
    for _ in range(3):
        await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invoice",
            headers={"X-User-Id": contractor_id},
            json=body,
        )

    after = await count_rows(sess, ChatMessage, thread_id=thread_id)
    assert after - before == 1, (
        f"в переписке появилось {after - before} сообщений вместо одного"
    )


async def test_a_different_key_still_creates_a_second_invoice(stand):
    """Идемпотентность не должна склеивать два разных счёта."""
    client, sess = stand
    _, contractor_id, project_id, thread_id = await project_with_thread(client)
    before = await count_rows(sess, Payment, project_id=project_id)

    for index in (1, 2):
        response = await client.post(
            f"/api/v1/projects/{project_id}/chats/{thread_id}/invoice",
            headers={"X-User-Id": contractor_id},
            json={
                "title": f"Счёт {index}",
                "amount": 1000 * index,
                "payment_type": "material",
                "client_request_id": f"chat-invoice-distinct-{index}",
            },
        )
        assert response.status_code == 200, response.text

    after = await count_rows(sess, Payment, project_id=project_id)
    assert after - before == 2, f"два разных счёта дали {after - before} платежей"


async def test_invoice_without_a_key_still_works(stand):
    """Старые клиенты ключа не присылают — их нельзя оставить без счёта."""
    client, sess = stand
    _, contractor_id, project_id, thread_id = await project_with_thread(client)
    before = await count_rows(sess, Payment, project_id=project_id)

    response = await client.post(
        f"/api/v1/projects/{project_id}/chats/{thread_id}/invoice",
        headers={"X-User-Id": contractor_id},
        json={"title": "Без ключа", "amount": 5000, "payment_type": "material"},
    )

    assert response.status_code == 200, response.text
    assert await count_rows(sess, Payment, project_id=project_id) - before == 1
