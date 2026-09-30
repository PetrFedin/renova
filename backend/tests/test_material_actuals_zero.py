"""Issue #379: quantity_actual == 0 must be preserved as a real measured zero,
not silently replaced by quantity_planned via a `quantity_actual or quantity_planned`
truthiness fallback (0 is falsy in Python).

Covers:
- material_stats() unit-level: explicit zero, positive actual, mixed material/work lines.
- /projects/{id}/estimate/materials-stats end-to-end (material_stats reconciliation).
- /projects/{id}/analytics end-to-end (materials_fact).
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.models.entities import EstimateLine, LineType
from app.services.estimate_service import material_stats
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users


def _line(line_type: LineType, quantity_planned: float, quantity_actual: float, unit_price: float) -> EstimateLine:
    return EstimateLine(
        project_id="p",
        line_type=line_type,
        name="x",
        unit="pcs",
        quantity_planned=quantity_planned,
        quantity_actual=quantity_actual,
        unit_price=unit_price,
    )


def test_material_stats_explicit_zero_actual_is_zero_not_plan():
    lines = [_line(LineType.material, quantity_planned=10, quantity_actual=0, unit_price=5)]
    stats = material_stats(lines)
    assert stats["planned"] == 50
    assert stats["actual"] == 0
    assert stats["overrun_percent"] == -100.0


def test_material_stats_positive_actual_unaffected():
    lines = [_line(LineType.material, quantity_planned=10, quantity_actual=7, unit_price=5)]
    stats = material_stats(lines)
    assert stats["planned"] == 50
    assert stats["actual"] == 35


def test_material_stats_mixed_material_and_work_lines_ignores_work_zero():
    lines = [
        _line(LineType.material, quantity_planned=10, quantity_actual=0, unit_price=5),
        _line(LineType.material, quantity_planned=4, quantity_actual=4, unit_price=10),
        _line(LineType.work, quantity_planned=100, quantity_actual=0, unit_price=1),
    ]
    stats = material_stats(lines)
    # materials only: planned = 50+40=90, actual = 0+40=40 (work line excluded entirely)
    assert stats["planned"] == 90
    assert stats["actual"] == 40


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "material_actuals_zero.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    from app.db import session as sess
    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_materials_stats_endpoint_preserves_explicit_zero():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        before = (await client.get(f"/api/v1/projects/{pid}/estimate/materials-stats", headers=h_cont)).json()

        created = await client.post(
            f"/api/v1/projects/{pid}/estimate/lines",
            headers=h_cont,
            json={"line_type": "material", "name": "Zero-actual material", "unit": "pcs", "quantity_planned": 10, "unit_price": 5},
        )
        assert created.status_code == 200, created.text
        line_id = created.json()["id"]
        patched = await client.patch(
            f"/api/v1/projects/{pid}/estimate/lines/{line_id}",
            headers=h_cont,
            json={"quantity_actual": 0},
        )
        assert patched.status_code == 200, patched.text

        after = (await client.get(f"/api/v1/projects/{pid}/estimate/materials-stats", headers=h_cont)).json()
        # Pre-fix, `actual or planned` would have added the new line's planned spend (50)
        # to `actual` too, because explicit 0 is falsy in Python.
        assert round(after["planned"] - before["planned"], 2) == 50
        assert round(after["actual"] - before["actual"], 2) == 0


async def test_analytics_endpoint_materials_fact_preserves_explicit_zero():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        before = (await client.get(f"/api/v1/projects/{pid}/analytics", headers=h_cust)).json()

        created = await client.post(
            f"/api/v1/projects/{pid}/estimate/lines",
            headers=h_cont,
            json={"line_type": "material", "name": "Zero-actual material", "unit": "pcs", "quantity_planned": 10, "unit_price": 5},
        )
        assert created.status_code == 200, created.text
        line_id = created.json()["id"]
        patched = await client.patch(
            f"/api/v1/projects/{pid}/estimate/lines/{line_id}",
            headers=h_cont,
            json={"quantity_actual": 0},
        )
        assert patched.status_code == 200, patched.text
        after = (await client.get(f"/api/v1/projects/{pid}/analytics", headers=h_cust)).json()
        # Pre-fix, materials_fact would include this line's planned spend (50) instead of 0.
        assert round(after["materials_plan"] - before["materials_plan"], 2) == 50
        assert round(after["materials_fact"] - before["materials_fact"], 2) == 0


async def test_analytics_endpoint_materials_fact_positive_actual_unaffected():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        before = (await client.get(f"/api/v1/projects/{pid}/analytics", headers=h_cust)).json()

        created = await client.post(
            f"/api/v1/projects/{pid}/estimate/lines",
            headers=h_cont,
            json={"line_type": "material", "name": "Positive-actual material", "unit": "pcs", "quantity_planned": 10, "unit_price": 5},
        )
        assert created.status_code == 200, created.text
        line_id = created.json()["id"]
        patched = await client.patch(
            f"/api/v1/projects/{pid}/estimate/lines/{line_id}",
            headers=h_cont,
            json={"quantity_actual": 3},
        )
        assert patched.status_code == 200, patched.text
        after = (await client.get(f"/api/v1/projects/{pid}/analytics", headers=h_cust)).json()
        assert round(after["materials_plan"] - before["materials_plan"], 2) == 50
        assert round(after["materials_fact"] - before["materials_fact"], 2) == 15
