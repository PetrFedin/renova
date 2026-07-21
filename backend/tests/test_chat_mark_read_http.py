"""HTTP endpoint tests for POST .../chats/{id}/read and clean GET chat."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config
from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "chat_read.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    sess.engine = create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _login(client: AsyncClient, role: str) -> dict:
    return (await client.post("/api/v1/auth/demo", json={"role": role})).json()


async def test_mark_read_http_counters_acl_idempotent_and_clean_get():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = await _login(client, "customer")
        cont = await _login(client, "contractor")
        assert cust.get("id") and cont.get("id")
        h_c = {"X-User-Id": cust["id"]}
        h_k = {"X-User-Id": cont["id"]}

        projects = (await client.get("/api/v1/projects", headers=h_c)).json()
        assert projects, "demo customer has project"
        pid = projects[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_k)

        created = await client.post(
            f"/api/v1/projects/{pid}/chats",
            headers=h_k,
            json={"title": "Unread HTTP test"},
        )
        assert created.status_code == 200, created.text
        tid = created.json()["id"]

        # 3 messages from contractor → customer unread > 0
        for i in range(3):
            r = await client.post(
                f"/api/v1/projects/{pid}/chats/{tid}/messages",
                headers=h_k,
                json={"text": f"msg-{i}", "message_type": "text"},
            )
            assert r.status_code == 200, r.text

        # GET must NOT mark read — unread stays > 0
        detail = await client.get(f"/api/v1/projects/{pid}/chats/{tid}", headers=h_c)
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body.get("unread_count", 0) >= 3, body

        # stranger ACL
        stranger = await _login(client, "customer")
        # second demo customer may share project; create fresh user via contractor without access
        bad = await client.post(
            f"/api/v1/projects/{pid}/chats/{tid}/read",
            headers={"X-User-Id": "no-such-user"},
        )
        assert bad.status_code in (401, 403, 404)

        # POST /read → counters
        read1 = await client.post(f"/api/v1/projects/{pid}/chats/{tid}/read", headers=h_c)
        assert read1.status_code == 200, read1.text
        data = read1.json()
        assert data["ok"] is True
        assert data["thread_id"] == tid
        assert data["thread_unread_count"] == 0
        assert isinstance(data["total_unread_count"], int)
        assert data["total_unread_count"] >= 0
        assert data.get("read_at")

        # after read GET shows 0
        detail2 = await client.get(f"/api/v1/projects/{pid}/chats/{tid}", headers=h_c)
        assert detail2.json().get("unread_count", 0) == 0

        # idempotent second POST
        read2 = await client.post(f"/api/v1/projects/{pid}/chats/{tid}/read", headers=h_c)
        assert read2.status_code == 200
        assert read2.json()["thread_unread_count"] == 0

        # archived thread: unread for project count still ok after archive
        arch = await client.patch(
            f"/api/v1/projects/{pid}/chats/{tid}/state",
            headers=h_c,
            json={"is_archived": True},
        )
        assert arch.status_code == 200, arch.text
        read3 = await client.post(f"/api/v1/projects/{pid}/chats/{tid}/read", headers=h_c)
        assert read3.status_code == 200
        assert read3.json()["thread_unread_count"] == 0
