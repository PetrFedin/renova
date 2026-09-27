"""Issue #472 (P0 Security): document stage_id/payment_id must be bound to the path project.

A user with write access to two projects (A and B) must not be able to attach a
Stage or Payment from Project B to a document created under Project A's path,
via either the JSON create endpoint or the multipart upload endpoint.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "doc_ref_acl.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config

    config.settings.database_url = url
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

    from app.services import project_assignment_service as assignment

    monkeypatch.setattr(assignment.settings, "contractor_free_project_limit", 99)


async def _setup_two_projects(client: AsyncClient):
    """One customer with two distinct projects (A, B); one contractor assigned to both."""
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust = {"X-User-Id": cust["id"]}
    h_cont = {"X-User-Id": cont["id"]}

    # The demo customer already has a seeded project (A); create a second, distinct
    # project (B) directly so the two projects are guaranteed not to collide.
    pid_a = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    created_b = await client.post(
        "/api/v1/projects",
        headers=h_cust,
        json={
            "name": "Project B",
            "renovation_type": "cosmetic",
            "property_type": "apartment",
            "rooms": [{"name": "Room", "length_m": 4, "width_m": 3, "height_m": 2.7}],
        },
    )
    assert created_b.status_code == 200, created_b.text
    pid_b = created_b.json()["id"]
    assert pid_a != pid_b

    assert (await client.post(f"/api/v1/projects/{pid_a}/assign", headers=h_cont)).status_code == 200
    assert (await client.post(f"/api/v1/projects/{pid_b}/assign", headers=h_cont)).status_code == 200

    stage_a = (
        await client.post(
            f"/api/v1/projects/{pid_a}/stages",
            headers=h_cont,
            json={"name": "Демонтаж A"},
        )
    ).json()
    stage_b = (
        await client.post(
            f"/api/v1/projects/{pid_b}/stages",
            headers=h_cont,
            json={"name": "Демонтаж B"},
        )
    ).json()
    stage_id_a = stage_a.get("id") or stage_a.get("stage", {}).get("id")
    stage_id_b = stage_b.get("id") or stage_b.get("stage", {}).get("id")
    assert stage_id_a and stage_id_b

    payment_b = (
        await client.post(
            f"/api/v1/projects/{pid_b}/payments",
            headers=h_cont,
            json={"title": "Материалы B", "amount": 1000, "payment_type": "material"},
        )
    ).json()
    payment_id_b = payment_b["id"]

    return {
        "pid_a": pid_a,
        "pid_b": pid_b,
        "h_cont": h_cont,
        "stage_id_a": stage_id_a,
        "stage_id_b": stage_id_b,
        "payment_id_b": payment_id_b,
    }


async def test_json_create_rejects_foreign_stage():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents",
            headers=ctx["h_cont"],
            json={"title": "Left", "document_type": "upload", "stage_id": ctx["stage_id_b"]},
        )
        assert resp.status_code == 404


async def test_json_create_rejects_foreign_payment():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents",
            headers=ctx["h_cont"],
            json={"title": "Left", "document_type": "upload", "payment_id": ctx["payment_id_b"]},
        )
        assert resp.status_code == 404


async def test_json_create_accepts_same_project_stage():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents",
            headers=ctx["h_cont"],
            json={"title": "Own stage doc", "document_type": "upload", "stage_id": ctx["stage_id_a"]},
        )
        assert resp.status_code == 200
        assert resp.json()["meta"]["stage_id"] == ctx["stage_id_a"]


async def test_multipart_upload_rejects_foreign_stage_and_skips_storage(monkeypatch):
    called = {"save_bytes": False}

    async def _fake_save_bytes(*args, **kwargs):
        called["save_bytes"] = True
        return "documents/should-not-be-called", "/should-not-be-called"

    from app.services import storage_service as storage_svc

    monkeypatch.setattr(storage_svc, "save_bytes", _fake_save_bytes)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents/upload",
            headers=ctx["h_cont"],
            data={"stage_id": ctx["stage_id_b"]},
            files={"file": ("evil.txt", b"hello", "text/plain")},
        )
        assert resp.status_code == 404
        assert called["save_bytes"] is False


async def test_multipart_upload_rejects_foreign_payment():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents/upload",
            headers=ctx["h_cont"],
            data={"payment_id": ctx["payment_id_b"]},
            files={"file": ("evil.txt", b"hello", "text/plain")},
        )
        assert resp.status_code == 404


async def test_multipart_upload_accepts_same_project_stage(tmp_path, monkeypatch):
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "uploads_dir", str(tmp_path))
    monkeypatch.setattr(cfg.settings, "s3_endpoint", None)
    monkeypatch.setattr(cfg.settings, "public_base_url", "http://127.0.0.1:8100")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ctx = await _setup_two_projects(client)
        resp = await client.post(
            f"/api/v1/projects/{ctx['pid_a']}/documents/upload",
            headers=ctx["h_cont"],
            data={"stage_id": ctx["stage_id_a"]},
            files={"file": ("ok.txt", b"hello", "text/plain")},
        )
        assert resp.status_code == 200
        assert resp.json()["meta"]["stage_id"] == ctx["stage_id_a"]
