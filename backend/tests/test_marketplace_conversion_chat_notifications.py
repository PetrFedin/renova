"""Конверсия заявки биржи, чат заявки и уведомления (MKT-006/007/008/010/028, ROLE-013)."""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import init_db
from app.main import app
from app.models.entities import DomainOutbox, Project, User, UserRole
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "lead_conversion.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    from app.db import session as sess

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
        db.add(User(id="rival-contractor", phone="+70000000999", role=UserRole.contractor))
        # демо-исполнитель уже занят демо-объектом (лимит бесплатного тарифа исчерпан)
        db.add(User(id="fresh-contractor", phone="+70000000998", role=UserRole.contractor))
        await db.commit()
    monkeypatch.setattr(config.settings, "contractor_free_project_limit", 1)


async def _world(client, *, quote=450000.0, note="Материалы за мой счёт"):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    ctr = {"id": "fresh-contractor"}
    ch, xh, rh = {"X-User-Id": cust["id"]}, {"X-User-Id": ctr["id"]}, {"X-User-Id": "rival-contractor"}
    lead = await client.post(
        "/api/v1/job-leads", headers=ch,
        json={"title": "Двушка", "address": "Казань, ул. Пушкина 1", "area_sqm": 50,
              "budget_hint": 900000, "renovation_type": "capital", "description": "Сносим одну перегородку"},
    )
    lead_id = lead.json()["id"]
    q = await client.post(f"/api/v1/job-leads/{lead_id}/quote", headers=xh,
                          json={"pre_estimate": quote, "note": note})
    assert q.status_code == 200, q.text
    rival = await client.post(f"/api/v1/job-leads/{lead_id}/quote", headers=rh, json={"pre_estimate": 777777.0})
    assert rival.status_code == 200, rival.text
    return lead_id, q.json()["quote_id"], cust["id"], ctr["id"], ch, xh, rh


async def _accept(client, lead_id, quote_id, ch):
    r = await client.post(f"/api/v1/job-leads/{lead_id}/quotes/{quote_id}/accept", headers=ch)
    assert r.status_code == 200, r.text


async def _notifications():
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        rows = (await db.execute(select(DomainOutbox).where(DomainOutbox.event_type == "notification.created"))).scalars().all()
        payloads = [json.loads(row.payload_json) for row in rows]
        # демо-данные уже содержат свои уведомления — берём события этой заявки
        return [p for p in payloads if p.get("link_path") == "/job-leads" or p.get("title") == "Заявка стала объектом"]


def _for(items, user_id):
    return [item for item in items if item["user_id"] == user_id]


async def test_conversion_carries_lead_and_quote_data_without_invented_room():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, cust_id, ctr_id, ch, xh, _rh = await _world(client)
        await _accept(client, lead_id, qid, ch)
        r = await client.post(f"/api/v1/job-leads/{lead_id}/convert", headers=ch, json={})
        assert r.status_code == 200, r.text
        pid = r.json()["project_id"]

        owner = (await client.get(f"/api/v1/projects/{pid}", headers=ch)).json()
        assert owner["rooms"] == []  # комнату 4x3 не выдумываем
        assert owner["customer_budget"] == 900000
        assert owner["address"] == "Казань, ул. Пушкина 1"
        assert owner["renovation_type"] == "capital"
        notes = owner["notes"]
        assert "Сносим одну перегородку" in notes
        assert "450 000" in notes and "Материалы за мой счёт" in notes
        assert "777" not in notes  # цена конкурента не попадает в проект

        contractor_view = (await client.get(f"/api/v1/projects/{pid}", headers=xh)).json()
        assert contractor_view["customer_budget"] is None  # приватный лимит заказчика


async def test_contractor_cannot_convert_lead():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, _c, _x, ch, xh, rh = await _world(client)
        await _accept(client, lead_id, qid, ch)
        for headers in (xh, rh):
            r = await client.post(f"/api/v1/job-leads/{lead_id}/convert", headers=headers, json={})
            assert r.status_code == 403, r.text
        from app.db import session as sess

        async with sess.SessionLocal() as db:
            assert (await db.execute(select(Project).where(Project.name == "Двушка"))).scalars().all() == []


async def test_conversion_respects_free_tier_limit_with_neutral_customer_message():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, cust_id, ctr_id, ch, xh, _rh = await _world(client)
        await _accept(client, lead_id, qid, ch)
        from app.db import session as sess

        async with sess.SessionLocal() as db:
            db.add(Project(name="Уже есть", renovation_type="cosmetic", customer_id=cust_id, contractor_id=ctr_id))
            await db.commit()
        r = await client.post(f"/api/v1/job-leads/{lead_id}/convert", headers=ch, json={})
        assert r.status_code == 402, r.text
        detail = r.json()["detail"]
        assert detail["code"] == "subscription_required"
        assert "Pro" not in detail["message"] and "тариф" not in detail["message"]
        assert "не может принять" in detail["message"]
        async with sess.SessionLocal() as db:
            assert len((await db.execute(select(Project).where(Project.name == "Двушка"))).scalars().all()) == 0
        # исполнитель узнаёт причину; повторная попытка в тот же день не дублирует
        await client.post(f"/api/v1/job-leads/{lead_id}/convert", headers=ch, json={})
        mine = [n for n in _for(await _notifications(), ctr_id) if n["title"] == "Объект по заявке не создан"]
        assert len(mine) == 1 and "лимит бесплатного тарифа" in mine[0]["body"]


async def test_pre_assignment_chat_is_closed_without_writing_into_void():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, _q, _c, _x, ch, xh, rh = await _world(client)
        for headers in (xh, rh):
            assert (await client.get(f"/api/v1/job-leads/{lead_id}/messages", headers=headers)).status_code == 404
            assert (await client.post(f"/api/v1/job-leads/{lead_id}/messages", headers=headers, json={"text": "x"})).status_code == 404
        owner_post = await client.post(f"/api/v1/job-leads/{lead_id}/messages", headers=ch, json={"text": "Здравствуйте"})
        assert owner_post.status_code == 409
        assert owner_post.json()["detail"]["code"] == "lead_chat_not_available"
        assert (await client.get(f"/api/v1/job-leads/{lead_id}/messages", headers=ch)).json() == []


async def test_lifecycle_notifications_hide_winner_price_from_losers():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, cust_id, ctr_id, ch, xh, rh = await _world(client)
        items = await _notifications()
        received = _for(items, cust_id)
        assert len(received) == 2 and all(n["title"] == "Новый отклик на заявку" for n in received)
        assert all(n["link_path"] == "/job-leads" and n["project_id"] is None for n in received)

        await _accept(client, lead_id, qid, ch)
        items = await _notifications()
        assert [n["title"] for n in _for(items, ctr_id)] == ["Ваше КП принято"]
        lost = _for(items, "rival-contractor")
        assert [n["title"] for n in lost] == ["Заявка закрыта"]
        assert "450" not in json.dumps(lost, ensure_ascii=False)


async def test_chat_message_notifies_counterpart_once_per_window():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, cust_id, ctr_id, ch, xh, rh = await _world(client)
        await _accept(client, lead_id, qid, ch)
        base = len(_for(await _notifications(), ctr_id))
        assert (await client.post(f"/api/v1/job-leads/{lead_id}/messages", headers=ch, json={"text": "Когда начнём?"})).status_code == 200
        assert (await client.post(f"/api/v1/job-leads/{lead_id}/messages", headers=ch, json={"text": "Ответьте"})).status_code == 200
        mine = _for(await _notifications(), ctr_id)
        assert len(mine) == base + 1 and mine[-1]["title"].startswith("Сообщение по заявке")
        assert (await client.post(f"/api/v1/job-leads/{lead_id}/messages", headers=xh, json={"text": "Завтра"})).status_code == 200
        assert any(n["title"].startswith("Сообщение по заявке") for n in _for(await _notifications(), cust_id))
        # проигравший конкурент в чат не попадает
        assert (await client.get(f"/api/v1/job-leads/{lead_id}/messages", headers=rh)).status_code == 404
