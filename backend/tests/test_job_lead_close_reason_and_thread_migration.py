"""MKT-005 причина закрытия заявки; MKT-010 миграция сообщений в треды; одна голова Alembic."""
import importlib.util
import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text

from app.db.session import init_db
from app.main import app
from app.models.entities import DomainOutbox, User, UserRole
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

BASE = "/api/v1"


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'lead_close.db'}"
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
        db.add(User(id="rival-contractor", phone="+70000000999", role=UserRole.contractor))
        db.add(User(id="bystander", phone="+70000000996", role=UserRole.contractor))
        await db.commit()


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _world(c):
    cust = (await c.post(f"{BASE}/auth/demo", json={"role": "customer"})).json()
    ctr = (await c.post(f"{BASE}/auth/demo", json={"role": "contractor"})).json()
    ch, xh, rh = {"X-User-Id": cust["id"]}, {"X-User-Id": ctr["id"]}, {"X-User-Id": "rival-contractor"}
    lid = (await c.post(f"{BASE}/job-leads", headers=ch, json={
        "title": "Кухня", "area_sqm": 20, "budget_hint": 500000, "address": "Москва, Тверская 1"})).json()["id"]
    assert (await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 123456.0})).status_code == 200
    assert (await c.post(f"{BASE}/job-leads/{lid}/quote", headers=rh, json={"pre_estimate": 654321.0})).status_code == 200
    return lid, ch, xh, rh, ctr["id"]


@pytest.mark.asyncio
async def test_close_stores_reason_shows_it_to_responders_and_notifies_without_prices():
    async with _client() as c:
        lid, ch, xh, rh, ctr_id = await _world(c)
        r1 = await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch, json={"reason": "  Передумал делать ремонт  "})
        assert r1.status_code == 200 and r1.json()["reason"] == "Передумал делать ремонт"
        # повтор идемпотентен и не затирает причину
        r2 = await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch, json={"reason": "другая"})
        assert r2.json()["closed_reason"] == "Передумал делать ремонт"
        owner = next(x for x in (await c.get(f"{BASE}/job-leads?status=closed", headers=ch)).json() if x["id"] == lid)
        assert owner["closed_reason"] == "Передумал делать ремонт" and owner["closed_at"]
        # причина > 500 символов отклоняется схемой
        assert (await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch, json={"reason": "я" * 501})).status_code == 422
        # исполнителям — уведомление с причиной, без цен
        from app.db import session as sess

        async with sess.SessionLocal() as db:
            rows = (await db.execute(select(DomainOutbox).where(DomainOutbox.event_type == "notification.created"))).scalars().all()
        mine = [p for p in (json.loads(r.payload_json) for r in rows) if p.get("title") == "Заявка закрыта заказчиком"]
        assert {p["user_id"] for p in mine} == {ctr_id, "rival-contractor"}
        assert all("Передумал делать ремонт" in p["body"] for p in mine)
        assert "123456" not in json.dumps(mine) and "654321" not in json.dumps(mine)
        # посторонний исполнитель причину не видит (и заявку закрытой не получает с причиной)
        seen = [x for x in (await c.get(f"{BASE}/job-leads?status=closed", headers={"X-User-Id": "bystander"})).json() if x["id"] == lid]
        assert all("closed_reason" not in x for x in seen)


@pytest.mark.asyncio
async def test_close_without_reason_is_allowed():
    async with _client() as c:
        lid, ch, *_ = await _world(c)
        r = await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch)
        assert r.status_code == 200 and r.json()["closed_reason"] is None


def _migration():
    path = next(Path(__file__).resolve().parents[1].glob("alembic/versions/x06coinvoicelink01_*.py"))
    spec = importlib.util.spec_from_file_location("x06_mig_threads", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_moves_legacy_messages_into_assigned_thread():
    mig = _migration()
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE job_leads (id VARCHAR(36) PRIMARY KEY, assigned_contractor_id VARCHAR(36))"))
        conn.execute(text(
            "CREATE TABLE lead_messages (id VARCHAR(36) PRIMARY KEY, lead_id VARCHAR(36), thread_contractor_id VARCHAR(36))"
        ))
        conn.execute(text("INSERT INTO job_leads VALUES ('L1', 'ctr-A'), ('L2', NULL)"))
        conn.execute(text(
            "INSERT INTO lead_messages (id, lead_id) VALUES ('m1','L1'), ('m2','L1'), ('m3','L2')"
        ))
        conn.execute(text("INSERT INTO lead_messages VALUES ('m4','L1','ctr-B')"))
        mig.backfill_lead_threads(conn)
        mig.backfill_lead_threads(conn)  # повтор безопасен
        got = dict(conn.execute(text("SELECT id, thread_contractor_id FROM lead_messages")).fetchall())
        assert got == {"m1": "ctr-A", "m2": "ctr-A", "m3": None, "m4": "ctr-B"}


def test_alembic_has_single_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert len(heads) == 1
