"""Ядро биржи: MKT-001..005, 009, 014, 024, 026, 039, 040."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "marketplace_core.db"
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
    from app.models.entities import User, UserRole

    async with sess.SessionLocal() as db:
        db.add(User(id="rival-contractor", phone="+70000000999", role=UserRole.contractor, npd_verified=True))
        db.add(User(id="gone-contractor", phone="+70000000888", role=UserRole.contractor, deleted_at=__import__("datetime").datetime(2026, 1, 1)))
        demo_contractors = (await db.execute(select(User).where(User.role == UserRole.contractor))).scalars().all()
        for contractor in demo_contractors:
            if contractor.deleted_at is None:
                contractor.npd_verified = True
        await db.commit()


BASE = "/api/v1"


async def _setup(client):
    cust = (await client.post(f"{BASE}/auth/demo", json={"role": "customer"})).json()
    ctr = (await client.post(f"{BASE}/auth/demo", json={"role": "contractor"})).json()
    ch, xh, rh = {"X-User-Id": cust["id"]}, {"X-User-Id": ctr["id"]}, {"X-User-Id": "rival-contractor"}
    return ch, xh, rh, ctr["id"]


async def _lead(client, ch, **over):
    body = {"title": "Ремонт", "area_sqm": 50, "budget_hint": 900000, "address": "Москва, Тверская 1"}
    body.update(over)
    r = await client.post(f"{BASE}/job-leads", headers=ch, json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_quote_locked_after_accept_and_note_saved():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        q = await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 450000, "note": "с материалами"})
        assert q.status_code == 200
        quotes = (await c.get(f"{BASE}/job-leads", headers=ch)).json()[0]["quotes"]
        assert quotes[0]["note"] == "с материалами"
        assert (await c.post(f"{BASE}/job-leads/{lid}/quotes/{q.json()['quote_id']}/accept", headers=ch)).status_code == 200
        r = await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 900000})
        assert r.status_code == 409 and r.json()["detail"] == "quote_locked_after_accept"
        w = await c.post(f"{BASE}/job-leads/{lid}/quote/withdraw", headers=xh)
        assert w.status_code == 409


async def test_withdraw_is_idempotent_and_removes_quote():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 100})
        a = await c.post(f"{BASE}/job-leads/{lid}/quote/withdraw", headers=xh)
        b = await c.post(f"{BASE}/job-leads/{lid}/quote/withdraw", headers=xh)
        assert a.json()["withdrawn"] is True and b.status_code == 200 and b.json()["withdrawn"] is False
        assert (await c.get(f"{BASE}/job-leads", headers=ch)).json()[0]["quotes"] == []


async def test_close_idempotent_and_blocks_quotes():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        assert (await c.post(f"{BASE}/job-leads/{lid}/close", headers=xh, json={})).status_code == 403
        r1 = await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch, json={"reason": "передумал"})
        r2 = await c.post(f"{BASE}/job-leads/{lid}/close", headers=ch)
        assert r1.json()["status"] == "closed" and r2.status_code == 200
        assert (await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 1})).status_code == 404
        assert (await c.patch(f"{BASE}/job-leads/{lid}", headers=ch, json={"title": "x"})).status_code == 409


async def test_patch_lead_only_while_open_unassigned():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        r = await c.patch(f"{BASE}/job-leads/{lid}", headers=ch, json={"budget_hint": 1000000, "renovation_type": "kitchen"})
        assert r.status_code == 200 and r.json()["budget_hint"] == 1000000 and r.json()["renovation_type"] == "kitchen"
        assert (await c.patch(f"{BASE}/job-leads/{lid}", headers=ch, json={"renovation_type": "junk"})).status_code == 422
        assert (await c.patch(f"{BASE}/job-leads/{lid}", headers=xh, json={"title": "x"})).status_code == 403
        q = await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 5})
        await c.post(f"{BASE}/job-leads/{lid}/quotes/{q.json()['quote_id']}/accept", headers=ch)
        assert (await c.patch(f"{BASE}/job-leads/{lid}", headers=ch, json={"title": "x"})).status_code == 409


async def test_decline_assignment_returns_lead_to_open():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        q = await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 777})
        await c.post(f"{BASE}/job-leads/{lid}/quotes/{q.json()['quote_id']}/accept", headers=ch)
        assert (await c.post(f"{BASE}/job-leads/{lid}/decline-assignment", headers=rh)).status_code == 404
        d = await c.post(f"{BASE}/job-leads/{lid}/decline-assignment", headers=xh)
        assert d.status_code == 200 and d.json()["status"] == "open"
        row = (await c.get(f"{BASE}/job-leads", headers=ch)).json()[0]
        assert row["status"] == "open" and row["assigned_contractor_id"] is None
        assert row["pre_estimate"] is None and row["quotes"] == []


async def test_auto_assign_refuses_reassign_and_unmatched():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        lid = await _lead(c, ch)
        # профилей со специализацией нет и откликов нет — честный отказ, никого не назначаем
        r = await c.post(f"{BASE}/job-leads/{lid}/auto-assign", headers=ch)
        assert r.status_code == 404 and r.json()["detail"] == "no_matching_contractors"
        assert (await c.get(f"{BASE}/job-leads", headers=ch)).json()[0]["assigned_contractor_id"] is None
        # победитель принят, повторный auto-assign не переназначает и не перетягивает цену
        q = await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 450000})
        await c.post(f"{BASE}/job-leads/{lid}/quotes/{q.json()['quote_id']}/accept", headers=ch)
        again = await c.post(f"{BASE}/job-leads/{lid}/auto-assign", headers=ch)
        assert again.status_code == 409
        rival = (await c.get(f"{BASE}/job-leads?status=quoted", headers=rh)).json()
        assert "450000" not in str(rival)


async def test_auto_assign_picks_quoter_with_own_price_else_matching_profile():
    async with _client() as c:
        ch, xh, rh, ctr_id = await _setup(c)
        lid = await _lead(c, ch)
        await c.post(f"{BASE}/job-leads/{lid}/quote", headers=xh, json={"pre_estimate": 300000})
        await c.post(f"{BASE}/job-leads/{lid}/quote", headers=rh, json={"pre_estimate": 200000})
        r = await c.post(f"{BASE}/job-leads/{lid}/auto-assign", headers=ch)
        assert r.status_code == 200, r.text
        # равные баллы -> дешевле; цена — победителя
        assert r.json()["contractor_id"] == "rival-contractor" and r.json()["pre_estimate"] == 200000
        assert r.json()["name"] == "Исполнитель" and "+7" not in str(r.json())
        # без откликов: подходит только исполнитель со специализацией
        lid2 = await _lead(c, ch, renovation_type="capital")
        await c.post(f"{BASE}/contractors/profile", headers=xh, json={"specialties": "capital,tiling"})
        r2 = await c.post(f"{BASE}/job-leads/{lid2}/auto-assign", headers=ch)
        assert r2.status_code == 200 and r2.json()["contractor_id"] == ctr_id and r2.json()["pre_estimate"] is None


async def test_profile_requisites_save_keeps_specialties_city_bio():
    async with _client() as c:
        ch, xh, rh, ctr_id = await _setup(c)
        await c.post(f"{BASE}/contractors/profile", headers=xh, json={"specialties": "tiling", "city": "Казань", "bio": "О себе"})
        await c.post(f"{BASE}/contractors/profile", headers=xh, json={"payment_requisites": "СБП +7"})
        p = (await c.get(f"{BASE}/contractors/me/profile", headers=xh)).json()
        assert (p["specialties"], p["city"], p["bio"], p["payment_requisites"]) == ("tiling", "Казань", "О себе", "СБП +7")


async def test_directory_exposes_user_id_hides_phone_and_deleted():
    async with _client() as c:
        ch, xh, rh, ctr_id = await _setup(c)
        for h in (xh, {"X-User-Id": "gone-contractor"}, rh):
            await c.post(f"{BASE}/contractors/profile", headers=h, json={"specialties": "capital"})
        for url in (f"{BASE}/contractors", f"{BASE}/contractors/match?renovation_type=capital"):
            rows = (await c.get(url, headers=ch)).json()
            assert rows and all(r["user_id"] and r["profile_id"] for r in rows)
            assert "gone-contractor" not in [r["user_id"] for r in rows]
            assert "+7000" not in str(rows)


async def test_portfolio_key_validated():
    async with _client() as c:
        ch, xh, rh, ctr_id = await _setup(c)
        pid = (await c.post(f"{BASE}/contractors/profile", headers=xh, json={"city": "x"})).json()["id"]
        bad = await c.post(f"{BASE}/contractors/{pid}/portfolio", headers=xh, params={"image_key": "../../etc/passwd"})
        other = await c.post(f"{BASE}/contractors/{pid}/portfolio", headers=xh, params={"image_key": "portfolio/someone-else/a.jpg"})
        ok = await c.post(f"{BASE}/contractors/{pid}/portfolio", headers=xh, params={"image_key": f"portfolio/{ctr_id}/a.jpg"})
        assert (bad.status_code, other.status_code, ok.status_code) == (422, 422, 200)


async def test_feed_pagination_filters_and_type_validation():
    async with _client() as c:
        ch, xh, rh, _ = await _setup(c)
        assert (await c.post(f"{BASE}/job-leads", headers=ch, json={"title": "t", "area_sqm": 1, "budget_hint": 1, "renovation_type": "garbage"})).status_code == 422
        for i in range(3):
            await _lead(c, ch, title=f"L{i}", budget_hint=100000 * (i + 1), renovation_type="kitchen" if i else "capital", address=f"Казань, ул {i}" if i else "Москва")
        assert len((await c.get(f"{BASE}/job-leads?limit=2", headers=xh)).json()) == 2
        assert len((await c.get(f"{BASE}/job-leads?limit=2&offset=2", headers=xh)).json()) == 1
        assert len((await c.get(f"{BASE}/job-leads?city=казан", headers=xh)).json()) == 2 or len((await c.get(f"{BASE}/job-leads?city=Казань", headers=xh)).json()) == 2
        assert [x["title"] for x in (await c.get(f"{BASE}/job-leads?renovation_type=capital", headers=xh)).json()] == ["L0"]
        assert len((await c.get(f"{BASE}/job-leads?budget_min=150000&budget_max=250000", headers=xh)).json()) == 1


async def test_profile_null_and_oversize_do_not_wipe_or_500():
    """MKT-003: явный null не стирает сохранённое, '' — осознанная очистка, длинное — 422."""
    async with _client() as c:
        ch, xh, rh, ctr_id = await _setup(c)
        await c.post(f"{BASE}/contractors/profile", headers=xh, json={"specialties": "tiling", "city": "Казань", "bio": "О себе"})
        r = await c.post(f"{BASE}/contractors/profile", headers=xh, json={"specialties": None, "city": None, "bio": "", "payment_requisites": "СБП"})
        assert r.status_code == 200
        p = (await c.get(f"{BASE}/contractors/me/profile", headers=xh)).json()
        assert (p["specialties"], p["city"], p["bio"], p["payment_requisites"]) == ("tiling", "Казань", "", "СБП")
        assert (await c.post(f"{BASE}/contractors/profile", headers=xh, json={"city": "x" * 65})).status_code == 422
        assert (await c.post(f"{BASE}/contractors/profile", headers=ch, json={"city": "x"})).status_code == 403
