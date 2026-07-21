"""Project archive / trash / restore lifecycle API."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.db import session as sess
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "project_lifecycle.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
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


async def _owner_headers(client: AsyncClient) -> tuple[dict, str]:
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    headers = {"X-User-Id": cust["id"]}
    listed = await client.get("/api/v1/projects", headers=headers)
    assert listed.status_code == 200
    return headers, listed.json()[0]["id"]


async def _guest_headers(client: AsyncClient) -> dict:
    guest = (await client.post("/api/v1/auth/demo/guest")).json()
    return {"X-User-Id": guest["id"]}


async def test_project_lifecycle_happy_path():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers, pid = await _owner_headers(client)

        ar = await client.post(f"/api/v1/projects/{pid}/archive", headers=headers)
        assert ar.status_code == 200
        assert ar.json()["is_archived"] is True
        assert ar.json()["access_mode"] == "owner"

        archived = await client.get("/api/v1/projects?bucket=archived", headers=headers)
        assert any(p["id"] == pid for p in archived.json())

        ua = await client.post(f"/api/v1/projects/{pid}/unarchive", headers=headers)
        assert ua.status_code == 200
        assert ua.json()["is_archived"] is False

        tr = await client.post(f"/api/v1/projects/{pid}/trash", headers=headers)
        assert tr.status_code == 200
        assert tr.json()["trashed_at"]

        trashed = await client.get("/api/v1/projects?bucket=trashed", headers=headers)
        assert any(p["id"] == pid for p in trashed.json())

        rs = await client.post(f"/api/v1/projects/{pid}/restore", headers=headers)
        assert rs.status_code == 200
        assert rs.json()["trashed_at"] is None

        await client.post(f"/api/v1/projects/{pid}/trash", headers=headers)
        purged = await client.delete(f"/api/v1/projects/{pid}", headers=headers)
        assert purged.status_code == 200
        assert purged.json()["ok"] is True

        active = await client.get("/api/v1/projects", headers=headers)
        assert not any(p["id"] == pid for p in active.json())


async def test_empty_trash_route():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers, pid = await _owner_headers(client)

        await client.post(f"/api/v1/projects/{pid}/trash", headers=headers)
        emptied = await client.delete("/api/v1/projects/trash/empty", headers=headers)
        assert emptied.status_code == 200
        assert emptied.json()["deleted"] >= 1

        trashed = await client.get("/api/v1/projects?bucket=trashed", headers=headers)
        assert trashed.status_code == 200
        assert trashed.json() == []


async def test_list_projects_access_mode_owner_and_guest():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        owner_headers, pid = await _owner_headers(client)
        guest_headers = await _guest_headers(client)

        owner_list = await client.get("/api/v1/projects", headers=owner_headers)
        owner_row = next(p for p in owner_list.json() if p["id"] == pid)
        assert owner_row["access_mode"] == "owner"

        guest_list = await client.get("/api/v1/projects", headers=guest_headers)
        assert guest_list.status_code == 200
        guest_row = next(p for p in guest_list.json() if p["id"] == pid)
        assert guest_row["access_mode"] == "guest"


async def test_lifecycle_forbidden_for_guest():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        owner_headers, pid = await _owner_headers(client)
        guest_headers = await _guest_headers(client)

        for method, path in [
            ("post", f"/api/v1/projects/{pid}/archive"),
            ("post", f"/api/v1/projects/{pid}/unarchive"),
            ("post", f"/api/v1/projects/{pid}/trash"),
            ("post", f"/api/v1/projects/{pid}/restore"),
            ("delete", f"/api/v1/projects/{pid}"),
        ]:
            resp = await getattr(client, method)(path, headers=guest_headers)
            assert resp.status_code == 403, f"{method} {path} expected 403, got {resp.status_code}"

        emptied = await client.delete("/api/v1/projects/trash/empty", headers=guest_headers)
        assert emptied.status_code == 403
