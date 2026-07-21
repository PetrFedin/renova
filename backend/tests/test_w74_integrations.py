"""W74: 1C archive, bank→expense, commerceml catalog, digest."""
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
    db_path = tmp_path / "w74.db"
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


async def test_1c_export_archives_document():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        exp = await client.get(f"/api/v1/projects/{pid}/export/1c-payments.csv", headers=h)
        assert exp.status_code == 200, exp.text
        assert "payment" in exp.text.lower() or "Тип" in exp.text or ";" in exp.text

        docs = await client.get(f"/api/v1/projects/{pid}/documents", headers=h)
        assert docs.status_code == 200, docs.text
        payload = docs.json()
        items = payload if isinstance(payload, list) else (payload.get("items") or payload.get("documents") or [])
        titles = [str(d.get("title") or "") for d in items]
        assert any("1С" in t or "1C" in t or "Выгрузка" in t for t in titles), titles[:20]


async def test_bank_unmatched_creates_expenses():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        csv_text = "date;amount;description\n2026-07-01;12345.00;Уникальный платёж W74 без матча\n"
        res = await client.post(
            f"/api/v1/projects/{pid}/import/bank-statement",
            headers=h,
            json={"csv_text": csv_text, "create_expenses": True},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("expenses_created", 0) >= 1


async def test_commerceml_includes_catalog_when_estimate_exists():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_c = {"X-User-Id": cust["id"]}
        h_k = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_c)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_k)
        # add estimate line via import
        await client.post(
            f"/api/v1/projects/{pid}/estimate/import-csv",
            headers=h_k,
            json={"csv_text": "name,line_type,unit,qty,price\nШтукатурка,work,м2,10,100\n"},
        )
        xml = await client.get(f"/api/v1/projects/{pid}/export/1c-commerceml.xml", headers=h_c)
        assert xml.status_code == 200, xml.text
        assert "Каталог" in xml.text or "Товар" in xml.text
        assert "Штукатурка" in xml.text


async def test_digest_weekly_creates_document():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        res = await client.post(f"/api/v1/projects/{pid}/digest/weekly", headers=h)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("ok") is True
        assert body.get("document_id")
        assert body.get("notified", 0) >= 1
