"""Job-lead quote price ACL: a contractor's pre_estimate is hidden from competing contractors."""
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
    db_path = tmp_path / "job_lead_w140.db"
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
        demo_contractors = (await db.execute(select(User).where(User.role == UserRole.contractor))).scalars().all()
        for contractor in demo_contractors:
            contractor.npd_verified = True
        await db.commit()


async def _lead_with_quote(client, price=111111.0):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    ctr = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    ch, xh, rh = {"X-User-Id": cust["id"]}, {"X-User-Id": ctr["id"]}, {"X-User-Id": "rival-contractor"}
    lead = await client.post(
        "/api/v1/job-leads",
        headers=ch,
        json={"title": "Ремонт", "area_sqm": 50, "budget_hint": 900000},
    )
    lead_id = lead.json()["id"]
    q = await client.post(f"/api/v1/job-leads/{lead_id}/quote", headers=xh, json={"pre_estimate": price})
    assert q.status_code == 200, q.text
    return lead_id, q.json()["quote_id"], ch, xh, rh


def _row(rows, lead_id):
    return next(x for x in rows if x["id"] == lead_id)


async def test_competing_contractor_cannot_see_rival_price():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, _qid, ch, xh, rh = await _lead_with_quote(client)

        rival = _row((await client.get("/api/v1/job-leads", headers=rh)).json(), lead_id)
        assert rival["pre_estimate"] is None
        assert rival.get("quotes", []) == []
        assert "111111" not in str(rival)

        mine = _row((await client.get("/api/v1/job-leads", headers=xh)).json(), lead_id)
        assert mine["pre_estimate"] == 111111.0
        assert [q["pre_estimate"] for q in mine["quotes"]] == [111111.0]

        owner = _row((await client.get("/api/v1/job-leads", headers=ch)).json(), lead_id)
        assert [q["pre_estimate"] for q in owner["quotes"]] == [111111.0]


async def test_rival_quote_does_not_overwrite_or_leak_via_lead_row():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, _qid, ch, xh, rh = await _lead_with_quote(client)
        r = await client.post(f"/api/v1/job-leads/{lead_id}/quote", headers=rh, json={"pre_estimate": 222222.0})
        assert r.status_code == 200, r.text
        first = _row((await client.get("/api/v1/job-leads", headers=xh)).json(), lead_id)
        assert first["pre_estimate"] == 111111.0
        assert [q["contractor_id"] for q in first["quotes"]] == [first["quotes"][0]["contractor_id"]]
        assert "222222" not in str(first)
        second = _row((await client.get("/api/v1/job-leads", headers=rh)).json(), lead_id)
        assert second["pre_estimate"] == 222222.0
        assert "111111" not in str(second)


async def test_accepted_price_visible_to_owner_and_assignee_only():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        lead_id, qid, ch, xh, rh = await _lead_with_quote(client)
        acc = await client.post(f"/api/v1/job-leads/{lead_id}/quotes/{qid}/accept", headers=ch)
        assert acc.status_code == 200, acc.text
        assert _row((await client.get("/api/v1/job-leads?status=quoted", headers=ch)).json(), lead_id)["pre_estimate"] == 111111.0
        assert _row((await client.get("/api/v1/job-leads?status=quoted", headers=xh)).json(), lead_id)["pre_estimate"] == 111111.0
        # assigned lead is no longer on the open board for rivals
        assert not [x for x in (await client.get("/api/v1/job-leads?status=quoted", headers=rh)).json() if x["id"] == lead_id]
