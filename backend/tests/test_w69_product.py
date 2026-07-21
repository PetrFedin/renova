"""W69: partial payment %, templates, escalate."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w69.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.secret_key = "test-secret-key-32chars-min!!"
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
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


async def test_list_and_create_from_template():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        templates = await client.get("/api/v1/projects/templates", headers=h)
        assert templates.status_code == 200
        items = templates.json()["items"]
        assert any(i["id"] == "apartment_2room" for i in items)
        r = await client.post(
            "/api/v1/projects/from-template",
            headers=h,
            json={"template_id": "studio", "name": "W69 Studio"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "W69 Studio"
        assert body["rooms_count"] >= 1
        assert len(body.get("estimate_lines") or []) >= 1


async def test_partial_stage_payment_percent():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = detail["stages"][0]
        # set payment_amount via patch if needed - stages may have amount from seed
        from app.db import session as sess
        from app.models.entities import Stage

        async with sess.SessionLocal() as db:
            st = await db.get(Stage, stage["id"])
            st.payment_amount = 100_000
            await db.commit()

        r = await client.post(
            f"/api/v1/projects/{pid}/payments",
            headers=h_cont,
            json={
                "title": "Аванс этапа",
                "payment_type": "stage",
                "stage_id": stage["id"],
                "percent": 30,
            },
        )
        assert r.status_code == 200, r.text
        assert abs(r.json()["amount"] - 30000) < 0.01
        prog = await client.get(
            f"/api/v1/projects/{pid}/stages/{stage['id']}/payment-progress",
            headers=h_cust,
        )
        assert prog.status_code == 200
        assert prog.json()["pending"] == 30000


async def test_escalate_issue():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        issue = await client.post(
            f"/api/v1/projects/{pid}/issues",
            headers=h_cust,
            json={"title": "Трещина", "severity": "medium"},
        )
        assert issue.status_code == 200, issue.text
        iid = issue.json()["id"]
        esc = await client.post(
            f"/api/v1/projects/{pid}/issues/{iid}/escalate",
            headers=h_cust,
        )
        assert esc.status_code == 200, esc.text
        body = esc.json()
        assert body["severity"] == "critical"
        assert body["title"].startswith("[Спор]")
