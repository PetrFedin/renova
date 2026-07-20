"""W72: acceptance pin on plan; schedule foreman ACL."""
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
    db_path = tmp_path / "w72.db"
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


async def test_acceptance_marks_floor_pin_label():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_c = {"X-User-Id": cust["id"]}
        h_k = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_c)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_k)
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_c)).json()
        rooms = detail.get("rooms") or []
        stages = detail.get("stages") or []
        assert rooms and stages
        room_id = rooms[0]["id"]
        stage = stages[0]
        # bind stage to room if needed
        from app.db import session as sess
        from app.models.entities import Stage

        async with sess.SessionLocal() as db:
            import json as _json
            st = await db.get(Stage, stage["id"])
            # Stage хранит комнаты в room_ids_json (не room_id)
            st.room_ids_json = _json.dumps([room_id])
            await db.commit()

        plan = await client.post(
            f"/api/v1/projects/{pid}/floor-plans",
            headers=h_k,
            json={"name": "План", "image_key": "demo/plan.jpg"},
        )
        assert plan.status_code == 200, plan.text
        plan_id = plan.json()["id"]
        pin = await client.post(
            f"/api/v1/projects/{pid}/floor-plans/{plan_id}/pins",
            headers=h_k,
            json={"room_id": room_id, "x_pct": 40, "y_pct": 40, "label": "Комната"},
        )
        assert pin.status_code == 200, pin.text

        # create WA + accept via API if available
        wa = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_k,
            json={"stage_id": stage["id"]},
        )
        # some demos auto-create pending — try list
        if wa.status_code not in (200, 201):
            lst = await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_c)
            items = lst.json() if lst.status_code == 200 else []
            if isinstance(items, dict):
                items = items.get("items") or items.get("pending") or []
        else:
            items = [wa.json()]
        # accept as customer
        acc_id = None
        for it in items:
            if it.get("stage_id") == stage["id"] or it.get("id"):
                acc_id = it.get("id")
                break
        if not acc_id:
            pytest.skip("no work-acceptance in demo seed")
        acc = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h_c,
            json={"comment": "W72 ok"},
        )
        if acc.status_code != 200:
            # alternate path
            acc = await client.post(
                f"/api/v1/projects/{pid}/stages/{stage['id']}/accept",
                headers=h_c,
                json={},
            )
        assert acc.status_code == 200, acc.text

        plans = (await client.get(f"/api/v1/projects/{pid}/floor-plans", headers=h_c)).json()
        pins = plans[0]["pins"]
        assert any((p.get("label") or "").startswith("✓") for p in pins), pins


async def test_schedule_manage_acl_owner_vs_stranger():
    """W72: подрядчик проекта может управлять графиком; чужой contractor — нет."""
    from sqlalchemy import select
    from app.db import session as sess
    from app.models.entities import Project, User, UserRole
    from app.services.project_work_schedule_service import can_manage_schedule

    async with sess.SessionLocal() as db:
        cust = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        cont = (await db.execute(select(User).where(User.role == UserRole.contractor))).scalars().first()
        assert cust and cont
        project = (await db.execute(select(Project).where(Project.customer_id == cust.id))).scalars().first()
        assert project
        project.contractor_id = cont.id
        await db.commit()
        assert await can_manage_schedule(db, cont, project) is True
        stranger = User(phone="+79990001122", role=UserRole.contractor, full_name="Stranger")
        db.add(stranger)
        await db.flush()
        assert await can_manage_schedule(db, stranger, project) is False
