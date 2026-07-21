"""W73: warranty post-closeout SLA, Grand-Smeta CSV, escalate ACL."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w73.db"
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


async def test_warranty_post_closeout_sets_sla():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_c = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_c)).json()[0]["id"]

        from app.db import session as sess
        from app.models.entities import Project

        async with sess.SessionLocal() as db:
            p = await db.get(Project, pid)
            p.is_archived = True
            await db.commit()

        res = await client.post(
            f"/api/v1/projects/{pid}/warranty-claims",
            headers=h_c,
            json={"title": "Течь смесителя", "description": "После сдачи"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True
        assert body["post_closeout"] is True
        assert body["sla_days"] == 14
        assert body.get("due_at")

        lst = await client.get(f"/api/v1/projects/{pid}/warranty-claims", headers=h_c)
        assert lst.status_code == 200
        data = lst.json()
        assert data["open"] >= 1
        assert data.get("post_closeout_allowed") is True

        snap = await client.get(f"/api/v1/projects/{pid}/closeout-checklist", headers=h_c)
        assert snap.status_code == 200
        s = snap.json()
        assert s["archived"] is True
        assert s["post_closeout"] is True
        assert "Гарантийный режим" in (s.get("next_action") or "")


async def test_estimate_import_grandsmeta_semicolon():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_c = {"X-User-Id": cust["id"]}
        h_k = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_c)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_k)

        csv_text = (
            "№;Наименование;Ед. изм.;Количество;Цена;Сумма\n"
            "1;Штукатурка стен;м2;10;450;4500\n"
            "2;Кабель ВВГ;м;50;35;1750\n"
        )
        res = await client.post(
            f"/api/v1/projects/{pid}/estimate/import-csv",
            headers=h_k,
            json={"csv_text": csv_text},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["created"] >= 2
        assert body.get("delimiter") == ";"


async def test_escalate_acl_member_forbidden():
    from app.db import session as sess
    from app.models.entities import Project, User, UserRole, ProjectIssue
    from app.services.team_service import create_team, require_capability
    from fastapi import HTTPException

    async with sess.SessionLocal() as db:
        cust = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        cont = (await db.execute(select(User).where(User.role == UserRole.contractor))).scalars().first()
        assert cust and cont
        project = (await db.execute(select(Project).where(Project.customer_id == cust.id))).scalars().first()
        assert project
        project.contractor_id = cont.id
        await db.commit()

        # owner can escalate
        role = await require_capability(db, cont, project, "escalate")
        assert role == "owner"

        # member cannot
        team = await create_team(db, cont.id, "Brigade W73")
        member = User(phone="+79991112233", role=UserRole.contractor, full_name="Member")
        db.add(member)
        await db.flush()
        from app.models.entities import TeamMember

        db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
        await db.commit()

        with pytest.raises(HTTPException) as ei:
            await require_capability(db, member, project, "escalate")
        assert ei.value.status_code == 403

        # member can field_write
        assert await require_capability(db, member, project, "field_write") == "member"

        # customer can escalate
        assert await require_capability(db, cust, project, "escalate") == "customer"
