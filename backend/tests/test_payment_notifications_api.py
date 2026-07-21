"""W56 payment honesty: route-level notification types for manual create/confirm."""
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.db import session as sess
from app.main import app
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import notification_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "payment_notifications.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()

    async with sess.SessionLocal() as db:
        customer = User(id="cust-w56", phone="+70000001001", role=UserRole.customer)
        contractor = User(id="cont-w56", phone="+70000001002", role=UserRole.contractor)
        project = Project(
            id="proj-w56",
            name="W56",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
            budget_planned=100000,
            budget_spent=0,
        )
        stage = Stage(
            id="stage-w56",
            project_id=project.id,
            name="Штукатурка",
            sort_order=1,
            status=StageStatus.done,
            payment_amount=5000,
            customer_accepted_at=datetime.utcnow(),
        )
        db.add_all([customer, contractor, project, stage])
        await db.commit()


async def test_manual_create_and_confirm_use_honest_notification_types(monkeypatch):
    captured: list[dict[str, str | None]] = []

    async def fake_notify(db, *, user_id, project_id, notification_type, title, body, link_path=None, return_to=None):
        captured.append(
            {
                "user_id": user_id,
                "project_id": project_id,
                "notification_type": notification_type,
                "title": title,
                "body": body,
                "link_path": link_path,
                "return_to": return_to,
            }
        )
        return None

    monkeypatch.setattr(notification_service, "notify", fake_notify)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_resp = await client.post(
            "/api/v1/projects/proj-w56/payments",
            headers={"X-User-Id": "cont-w56"},
            json={
                "title": "Оплата этапа",
                "amount": 5000,
                "payment_type": "stage",
                "stage_id": "stage-w56",
                "notes": "Счёт после приёмки",
            },
        )
        assert create_resp.status_code == 200
        created = create_resp.json()
        assert created["status"] == "pending"
        assert captured == [
            {
                "user_id": "cust-w56",
                "project_id": "proj-w56",
                "notification_type": "payment_pending",
                "title": "Счёт к оплате: Оплата этапа",
                "body": "5000.0",
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
                "return_to": "/(customer)/(tabs)/home",
            }
        ]

        confirm_resp = await client.post(
            f"/api/v1/projects/proj-w56/payments/{created['id']}/confirm",
            headers={"X-User-Id": "cust-w56"},
            json={"transfer_ack": True},
        )
        assert confirm_resp.status_code == 200
        confirmed = confirm_resp.json()
        assert confirmed["status"] == "confirmed"
        assert captured[1:] == [
            {
                "user_id": "cont-w56",
                "project_id": "proj-w56",
                "notification_type": "payment_confirmed",
                "title": "Оплата подтверждена: Оплата этапа",
                "body": "5000.0",
                "link_path": "/(contractor)/(tabs)/budget",
                "return_to": "/(contractor)/(tabs)/home",
            }
        ]
