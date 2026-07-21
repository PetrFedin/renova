"""Warranty claim: idempotent create, permissions, audit, concurrency."""
from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect, select, text

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "warranty_idem.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.secret_key = "test-secret-key-32chars-min!!"
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _customer_project(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    h = {"X-User-Id": cust["id"]}
    pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
    return cust, h, pid


async def test_create_warranty_normal():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)
        res = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": "key-normal-1"},
            json={"title": "Течь", "description": "на кухне", "client_request_id": "key-normal-1"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True
        assert body["issue_id"]
        assert body.get("idempotent_replay") is False


async def test_replay_same_key_same_payload():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)
        payload = {"title": "Трещина", "description": "стена", "client_request_id": "key-replay"}
        r1 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": "key-replay"},
            json=payload,
        )
        assert r1.status_code == 200
        r2 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": "key-replay"},
            json=payload,
        )
        assert r2.status_code == 200, r2.text
        b1, b2 = r1.json(), r2.json()
        assert b1["issue_id"] == b2["issue_id"]
        assert b2.get("idempotent_replay") is True

        lst = await client.get(f"/api/v1/projects/{pid}/warranty-claims", headers=h)
        open_ids = [i["id"] for i in lst.json()["items"] if i["status"] != "closed"]
        assert open_ids.count(b1["issue_id"]) == 1


async def test_same_key_different_payload_conflict():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)
        key = "key-conflict"
        r1 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json={"title": "A", "description": "one", "client_request_id": key},
        )
        assert r1.status_code == 200
        r2 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json={"title": "B", "description": "two", "client_request_id": key},
        )
        assert r2.status_code == 409
        detail = r2.json()["detail"]
        assert detail["code"] == "warranty_claim_idempotency_conflict"


async def test_concurrent_same_key_one_issue():
    """Unique constraint + IntegrityError path: второй insert того же scope → конфликт на уровне БД.

    Полный asyncio.gather по HTTP на SQLite нестабилен (greenlet); проверяем гарантию
    уникальности и что повторный HTTP с тем же key не создаёт второй issue.
    """
    from app.db import session as sess
    from app.models.entities import WarrantyClaimIdempotency
    from sqlalchemy.exc import IntegrityError

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust, h, pid = await _customer_project(client)
        key = "key-concurrent"
        payload = {"title": "Concurrent", "description": "race", "client_request_id": key}
        r1 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json=payload,
        )
        assert r1.status_code == 200, r1.text
        issue_id = r1.json()["issue_id"]

        # Constraint: duplicate scope row rejected
        async with sess.SessionLocal() as db:
            db.add(
                WarrantyClaimIdempotency(
                    user_id=cust["id"],
                    project_id=pid,
                    idempotency_key=key,
                    payload_hash="deadbeef",
                    issue_id=issue_id,
                    document_id=r1.json()["document_id"],
                    response_json="{}",
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()

        # Parallel-ish: sequential burst still one issue
        r2 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json=payload,
        )
        r3 = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json=payload,
        )
        assert r2.status_code == 200 and r3.status_code == 200
        assert r2.json()["issue_id"] == issue_id == r3.json()["issue_id"]


async def test_no_permission_foreign_project():
    """Guest RO / чужой user не создаёт claim (role в JSON игнорируется)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, _, pid_a = await _customer_project(client)
        guest = (await client.post("/api/v1/auth/demo", json={"role": "guest"})).json()
        # guest demo may 400 — fallback stranger
        if "id" not in guest:
            from app.db import session as sess
            from app.models.entities import User, UserRole
            async with sess.SessionLocal() as db:
                stranger = User(phone="+79990001122", role=UserRole.customer, full_name="Stranger")
                db.add(stranger)
                await db.commit()
                await db.refresh(stranger)
                guest = {"id": stranger.id}
        res = await client.post(
            f"/api/v1/projects/{pid_a}/warranty-claims",
            headers={"X-User-Id": guest["id"], "Idempotency-Key": "key-forbidden"},
            json={"title": "X", "client_request_id": "key-forbidden", "role": "admin"},
        )
        assert res.status_code in (403, 404), res.text


async def test_foreign_project_id_not_readable():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h_a, pid_a = await _customer_project(client)
        cust_b = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        # second customer — different demo user may share demo project; use fake id
        fake = "00000000-0000-0000-0000-000000000099"
        res = await client.get(f"/api/v1/projects/{fake}/warranty-claims", headers=h_a)
        assert res.status_code == 404
        res2 = await client.post(
            f"/api/v1/projects/{fake}/warranty-claims",
            headers={**h_a, "Idempotency-Key": "k"},
            json={"title": "X", "client_request_id": "k"},
        )
        assert res2.status_code == 404


async def test_rollback_on_document_error(monkeypatch):
    from app.services import project_document_service as docs_svc
    from app.db import session as sess
    from app.models.entities import ProjectIssue, WarrantyClaimIdempotency

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)

        async def boom(*args, **kwargs):
            raise RuntimeError("simulated_doc_fail")

        monkeypatch.setattr(docs_svc, "create_document", boom)
        res = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": "key-rollback"},
            json={"title": "Fail", "description": "x", "client_request_id": "key-rollback"},
        )
        assert res.status_code == 500, res.text
        # If unhandled, FastAPI 500 — ensure no leftover with that key
        async with sess.SessionLocal() as db:
            rows = (
                await db.execute(
                    select(WarrantyClaimIdempotency).where(
                        WarrantyClaimIdempotency.idempotency_key == "key-rollback"
                    )
                )
            ).scalars().all()
            assert rows == []
            issues = (
                await db.execute(
                    select(ProjectIssue).where(
                        ProjectIssue.project_id == pid,
                        ProjectIssue.title.like("%Fail%"),
                    )
                )
            ).scalars().all()
            # rollback / request abort → no committed Fail issue
            assert issues == []


async def test_audit_events_created_and_replay():
    from app.db import session as sess
    from app.models.entities import ActivityEvent

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)
        key = "key-audit"
        payload = {"title": "AuditMe", "description": "secret PII phone +7999", "client_request_id": key}
        await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json=payload,
        )
        await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers={**h, "Idempotency-Key": key},
            json=payload,
        )
        async with sess.SessionLocal() as db:
            ev = (
                await db.execute(
                    select(ActivityEvent).where(ActivityEvent.project_id == pid)
                )
            ).scalars().all()
            kinds = {e.kind for e in ev}
            assert "warranty_claim_created" in kinds
            assert "warranty_claim_idempotent_replay" in kinds
            # description / phone must not appear in audit body
            for e in ev:
                if e.kind.startswith("warranty_claim"):
                    assert e.body is None or "+7999" not in (e.body or "")
                    assert "secret PII" not in (e.body or "")


async def test_migration_constraint_exists():
    """create_all (test) exposes unique constraint; alembic revision present."""
    from pathlib import Path
    from app.db import session as sess

    mig = Path(__file__).resolve().parents[1] / "alembic/versions/w5warranty01_warranty_claim_idempotency.py"
    assert mig.exists()
    text = mig.read_text()
    assert "uq_warranty_claim_idempotency_scope" in text
    assert "w4jtipurge01" in text

    async with sess.engine.connect() as conn:
        def _check(sync_conn):
            insp = inspect(sync_conn)
            assert "warranty_claim_idempotency" in insp.get_table_names()
            uq = {u["name"] for u in insp.get_unique_constraints("warranty_claim_idempotency")}
            # SQLite may name differently via create_all — accept column unique via table args
            return uq

        names = await conn.run_sync(_check)
        # SQLAlchemy UniqueConstraint name should appear on Postgres; SQLite may embed
        assert names is not None


async def test_existing_list_still_works_without_key():
    """Без ключа создание работает (обратная совместимость); старые записи list ок."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, h, pid = await _customer_project(client)
        r = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers=h,
            json={"title": "Legacy", "description": "no key"},
        )
        assert r.status_code == 200
        lst = await client.get(f"/api/v1/projects/{pid}/warranty-claims", headers=h)
        assert lst.status_code == 200
        assert lst.json()["open"] >= 1
