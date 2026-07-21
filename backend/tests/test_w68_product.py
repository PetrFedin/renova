"""W68: estimate lock-diff, photos_required, propose owner gate."""
from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import (
    EstimateLine,
    LineType,
    Project,
    StagePhoto,
    User,
    UserRole,
)
from app.services import estimate_service as est
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import complete_stage_checklist

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w68.db"
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


async def test_estimate_lock_diff_after_propose(db):
    cust = User(id="c-w68", phone="+79990006801", role=UserRole.customer)
    contr = User(id="k-w68", phone="+79990006802", role=UserRole.contractor)
    project = Project(
        id="p-w68",
        name="W68",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
    )
    line = EstimateLine(
        id="el-w68",
        project_id=project.id,
        line_type=LineType.work,
        name="Работа",
        unit="шт",
        quantity_planned=1,
        unit_price=100,
    )
    db.add_all([cust, contr, project, line])
    await db.commit()

    await est.propose_estimate_lock(db, project.id, proposed_by=contr.id)
    line.unit_price = 150
    await db.commit()

    diff = await est.get_estimate_lock_diff(db, project.id)
    assert diff and diff["has_baseline"]
    assert diff["has_changes"]
    assert diff["delta_total"] == 50.0


async def test_accept_requires_photos():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        pending = (await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_cust)).json()
        open_acc = next(
            (a for a in pending if a.get("status") in ("requested", "in_review", "pending")),
            None,
        )
        assert open_acc
        # удалить фото этапа если есть — через DB
        from app.db import session as sess
        from app.models.entities import StagePhoto
        from sqlalchemy import delete, select

        await complete_stage_checklist(client, pid, open_acc["stage_id"], h_cont)
        async with sess.SessionLocal() as db:
            await db.execute(delete(StagePhoto).where(StagePhoto.stage_id == open_acc["stage_id"]))
            await db.commit()

        r = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{open_acc['id']}/accept",
            headers=h_cust,
            json={"comment": "без фото"},
        )
        assert r.status_code == 409, r.text
        assert "photos_required" in r.text
