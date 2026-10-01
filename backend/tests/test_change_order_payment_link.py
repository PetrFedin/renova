"""JRN-004 / MNY-020 / DOC-006: approve не 500, один счёт на допработу (колонка change_order_id), подпись документа."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.db.session import init_db
from app.main import app
from app.models.entities import Payment
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import self_assign

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'co_pay.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    config.settings.database_url = url
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _setup(client):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust, h_cont = {"X-User-Id": cust["id"]}, {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await self_assign(client, pid, h_cont)
    return pid, h_cust, h_cont


async def _create(client, pid, h_cont, title="Тёплый пол", amount=30000, **extra):
    r = await client.post(
        f"/api/v1/projects/{pid}/change-orders", headers=h_cont,
        json={"title": title, "amount": amount, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _co_payments(pid):
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        rows = (await db.execute(select(Payment).where(Payment.project_id == pid))).scalars().all()
        return [p for p in rows if p.change_order_id]


async def test_approve_survives_failing_outbox_and_is_idempotent(monkeypatch):
    from app.services import outbox_service

    async def boom(*args, **kwargs):
        raise RuntimeError("poison outbox row")

    monkeypatch.setattr(outbox_service, "dispatch_pending", boom)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        co_id = await _create(client, pid, h_cont)
        url = f"/api/v1/projects/{pid}/change-orders/{co_id}/approve"
        first = await client.post(url, headers=h_cust)
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["status"] == "approved" and body["amount"] == 30000
        assert body["replayed"] is False and body["payment_id"]
        second = await client.post(url, headers=h_cust)
        assert second.status_code == 200
        assert second.json()["replayed"] is True
        assert second.json()["payment_id"] == body["payment_id"]


async def test_approve_creates_single_invoice_with_amount_and_visible_status():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        co_id = await _create(client, pid, h_cont, amount=30000)
        for _ in range(3):
            r = await client.post(f"/api/v1/projects/{pid}/change-orders/{co_id}/approve", headers=h_cust)
            assert r.status_code == 200
        payments = await _co_payments(pid)
        assert len(payments) == 1
        assert payments[0].amount == 30000 and payments[0].status.value == "pending"
        listed = (await client.get(f"/api/v1/projects/{pid}/change-orders", headers=h_cust)).json()
        row = next(x for x in listed if x["id"] == co_id)
        assert row["payment_id"] == payments[0].id and row["payment_status"] == "pending"
        shown = (await client.get(f"/api/v1/projects/{pid}/payments", headers=h_cust)).json()
        assert any(p["id"] == payments[0].id and p["amount"] == 30000 for p in shown)


async def test_reject_creates_no_invoice():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        co_id = await _create(client, pid, h_cont, title="Лишнее", amount=5000)
        r = await client.post(f"/api/v1/projects/{pid}/change-orders/{co_id}/reject", headers=h_cust)
        assert r.status_code == 200
        assert await _co_payments(pid) == []
        listed = (await client.get(f"/api/v1/projects/{pid}/change-orders", headers=h_cust)).json()
        assert next(x for x in listed if x["id"] == co_id)["payment_id"] is None


async def test_change_order_document_signed_by_both_parties():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        co_id = await _create(client, pid, h_cont)
        doc_id = (await client.post(
            f"/api/v1/projects/{pid}/change-orders/{co_id}/approve", headers=h_cust
        )).json()["document_id"]
        for headers in (h_cust, h_cont):
            r = await client.post(
                f"/api/v1/projects/{pid}/documents/{doc_id}/sign",
                headers=headers, json={"provider": "in_app"},
            )
            assert r.status_code == 200, r.text
        docs = (await client.get(f"/api/v1/projects/{pid}/documents", headers=h_cust)).json()["items"]
        doc = next(d for d in docs if d["id"] == doc_id)
        assert doc["status"] == "active"  # обе стороны подписали
        pdf = await client.get(f"/api/v1/projects/{pid}/change-orders/{co_id}/document.pdf", headers=h_cust)
        assert pdf.status_code == 200


async def test_invoice_linked_by_column_and_inherits_stage_without_marker():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        from app.db import session as sess
        from app.models.entities import Stage

        async with sess.SessionLocal() as db:
            stage_id = (await db.execute(select(Stage.id).where(Stage.project_id == pid).limit(1))).scalar_one()
        co_id = await _create(client, pid, h_cont, stage_id=stage_id)
        url = f"/api/v1/projects/{pid}/change-orders/{co_id}/approve"
        first = (await client.post(url, headers=h_cust)).json()
        again = (await client.post(url, headers=h_cust)).json()
        assert first["stage_id"] == stage_id and again["payment_id"] == first["payment_id"]
        payments = await _co_payments(pid)
        assert len(payments) == 1
        assert payments[0].change_order_id == co_id and payments[0].stage_id == stage_id
        assert "CO:" not in (payments[0].notes or "")
        listed = (await client.get(f"/api/v1/projects/{pid}/change-orders", headers=h_cust)).json()
        row = next(x for x in listed if x["id"] == co_id)
        assert row["stage_id"] == stage_id and row["payment_id"] == payments[0].id
        assert row["payment_status"] == "pending"


async def test_create_rejects_foreign_or_unknown_stage():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        pid, h_cust, h_cont = await _setup(client)
        r = await client.post(
            f"/api/v1/projects/{pid}/change-orders", headers=h_cont,
            json={"title": "x", "amount": 100, "stage_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert r.status_code == 404 and r.json()["detail"] == "stage_not_found"


async def test_migration_backfills_marker_into_column():
    import importlib.util
    from pathlib import Path

    from sqlalchemy import create_engine, text

    path = next(Path(__file__).resolve().parents[1].glob("alembic/versions/x06coinvoicelink01_*.py"))
    spec = importlib.util.spec_from_file_location("x06_mig", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    assert mig.down_revision == "x05teaminviteinvitee01"

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE change_orders (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE payments (id VARCHAR(36) PRIMARY KEY, notes TEXT, change_order_id VARCHAR(36))"))
        conn.execute(text("INSERT INTO change_orders VALUES ('co-1')"))
        conn.execute(text(
            "INSERT INTO payments (id, notes) VALUES "
            "('p-marker', 'CO:co-1; доп. работы'), ('p-plain', 'просто счёт'), "
            "('p-orphan', 'CO:co-gone; доп. работы'), ('p-null', NULL)"
        ))
        assert mig.backfill_change_order_links(conn) == 1
        assert mig.backfill_change_order_links(conn) == 0  # повтор безопасен
        rows = {r[0]: (r[1], r[2]) for r in conn.execute(text("SELECT id, change_order_id, notes FROM payments"))}
        assert rows["p-marker"] == ("co-1", "доп. работы")
        assert rows["p-plain"] == (None, "просто счёт")
        assert rows["p-orphan"] == (None, "CO:co-gone; доп. работы")
        assert rows["p-null"] == (None, None)
        mig.restore_change_order_markers(conn)
        restored = conn.execute(text("SELECT notes FROM payments WHERE id='p-marker'")).scalar()
        assert restored == "CO:co-1; доп. работы"
