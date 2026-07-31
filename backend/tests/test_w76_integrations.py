"""W76: dashboard enrich — WA / CO / warranty / draft docs → next_action fields."""
from datetime import datetime, timedelta

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
    monkeypatch.setattr(cfg.settings, "database_url", url)
    monkeypatch.setattr(cfg.settings, "environment", "test")
    monkeypatch.setattr(cfg.settings, "allow_create_all", True)
    monkeypatch.setattr(cfg.settings, "allow_demo_seed", True)
    monkeypatch.setattr(cfg.settings, "secret_key", "test-secret-key-32chars-min!!")
    monkeypatch.setattr(cfg.settings, "public_base_url", "http://127.0.0.1:8081")
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
        customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": customer["id"]}
        project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]
        dashboard = (await client.get(f"/api/v1/projects/{project_id}/dashboard", headers=headers)).json()
        assert "pending_acceptances" in dashboard
        assert "pending_change_orders" in dashboard
        assert "warranty_open" in dashboard
        assert "warranty_overdue" in dashboard
        assert "pending_sign_docs" in dashboard


async def test_dashboard_next_action_follows_pending_co():
    from app.db import session as sess
    from app.models.entities import ChangeOrder, ChangeOrderStatus, Project, User, UserRole

    async with sess.SessionLocal() as db:
        customer = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        project = (await db.execute(select(Project).where(Project.customer_id == customer.id))).scalars().first()
        assert project
        db.add(
            ChangeOrder(
                project_id=project.id,
                title="W76 ДО",
                amount=1000,
                status=ChangeOrderStatus.pending,
                created_by=customer.id,
            )
        )
        await db.commit()
        project_id = project.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": customer["id"]}
        dashboard = (await client.get(f"/api/v1/projects/{project_id}/dashboard", headers=headers)).json()
        assert dashboard.get("pending_change_orders", 0) >= 1
        if dashboard.get("pending_acceptances", 0) == 0:
            assert dashboard.get("next_action_type") == "change_order"
            title = dashboard.get("next_action_title") or ""
            assert "доп" in title.lower() or "ДО" in title


async def test_enrich_dashboard_warranty_when_complete():
    from app.db import session as sess
    from app.models.entities import Project, ProjectIssue, Stage, StageStatus, User, UserRole
    from app.services import project_service as service

    async with sess.SessionLocal() as db:
        customer = (await db.execute(select(User).where(User.role == UserRole.customer))).scalars().first()
        project = (await db.execute(select(Project).where(Project.customer_id == customer.id))).scalars().first()
        assert project
        stages = list((await db.execute(select(Stage).where(Stage.project_id == project.id))).scalars().all())
        for stage in stages:
            stage.status = StageStatus.done
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
        dashboard = service.build_dashboard(project)
        dashboard = await service.enrich_dashboard_actions(db, project.id, dashboard, role="customer")
        assert dashboard["warranty_open"] >= 1
        assert dashboard["warranty_overdue"] >= 1
        assert dashboard["next_action_type"] == "warranty"
