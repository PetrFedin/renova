"""W76: dashboard enrich — WA / CO / warranty / draft docs → next_action fields."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w76.db"
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


async def test_dashboard_exposes_queue_counters():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        dash = (await client.get(f"/api/v1/projects/{pid}/dashboard", headers=h)).json()
        assert "pending_acceptances" in dash
        assert "pending_change_orders" in dash
        assert "warranty_open" in dash
        assert "warranty_overdue" in dash
        assert "pending_sign_docs" in dash


async def test_dashboard_next_action_follows_pending_co():
    from app.db import session as sess
    from app.models.entities import ChangeOrder, ChangeOrderStatus, Project, User, UserRole

    async with sess.SessionLocal() as db:
        cust = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        project = (await db.execute(select(Project).where(Project.customer_id == cust.id))).scalars().first()
        assert project
        db.add(
            ChangeOrder(
                project_id=project.id,
                title="W76 ДО",
                amount=1000,
                status=ChangeOrderStatus.pending,
                created_by=cust.id,
            )
        )
        await db.commit()
        pid = project.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        dash = (await client.get(f"/api/v1/projects/{pid}/dashboard", headers=h)).json()
        assert dash.get("pending_change_orders", 0) >= 1
        if dash.get("pending_acceptances", 0) == 0:
            assert dash.get("next_action_type") == "change_order"
            title = dash.get("next_action_title") or ""
            assert "доп" in title.lower() or "ДО" in title


async def test_enrich_dashboard_warranty_when_complete():
    from app.db import session as sess
    from app.models.entities import Project, ProjectIssue, Stage, StageStatus, User, UserRole
    from app.services import project_service as svc
    from datetime import datetime, timedelta

    async with sess.SessionLocal() as db:
        cust = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        project = (await db.execute(select(Project).where(Project.customer_id == cust.id))).scalars().first()
        assert project
        stages = list((await db.execute(select(Stage).where(Stage.project_id == project.id))).scalars().all())
        for st in stages:
            st.status = StageStatus.done
        db.add(
            ProjectIssue(
                project_id=project.id,
                title="[Гарантия] W76",
                severity="medium",
                status="open",
                due_at=datetime.utcnow() - timedelta(days=2),
            )
        )
        await db.commit()
        project = (
            await db.execute(
                select(Project)
                .where(Project.id == project.id)
                .options(
                    selectinload(Project.stages),
                    selectinload(Project.estimate_lines),
                    selectinload(Project.payments),
                )
            )
        ).scalar_one()
        dash = svc.build_dashboard(project)
        dash = await svc.enrich_dashboard_actions(db, project.id, dash, role="customer")
        assert dash["warranty_open"] >= 1
        assert dash["warranty_overdue"] >= 1
        assert dash["next_action_type"] == "warranty"
