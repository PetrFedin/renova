"""Payment API must not report failure after its durable financial commit succeeded."""
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
from app.services import notification_service, outbox_service
from app.services.client_write_side_effects import (
    clear_request_side_effect_context,
    payment_transition_side_effects_suppressed,
    take_client_write_side_effect,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    clear_request_side_effect_context()
    db_path = tmp_path / "payment-post-commit-delivery.db"
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
        customer = User(
            id="customer-post-commit",
            phone="+70000002101",
            role=UserRole.customer,
        )
        contractor = User(
            id="contractor-post-commit",
            phone="+70000002102",
            role=UserRole.contractor,
        )
        project = Project(
            id="project-post-commit",
            name="Post-commit delivery",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
            budget_planned=100000,
            budget_spent=0,
        )
        stage = Stage(
            id="stage-post-commit",
            project_id=project.id,
            name="Штукатурка",
            sort_order=1,
            status=StageStatus.done,
            payment_amount=5000,
            customer_accepted_at=datetime.utcnow(),
        )
        db.add_all([customer, contractor, project, stage])
        await db.commit()

    yield
    clear_request_side_effect_context()
    await sess.engine.dispose()


async def test_payment_create_survives_inline_push_failure_and_worker_recovers(
    monkeypatch,
    caplog,
):
    monkeypatch.setattr(
        notification_service,
        "notify",
        AsyncMock(side_effect=RuntimeError("push_delivery_failed")),
    )
    monkeypatch.setattr(
        notification_service,
        "send_push",
        AsyncMock(return_value=True),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/projects/project-post-commit/payments",
            headers={"X-User-Id": "contractor-post-commit"},
            json={
                "title": "Оплата этапа",
                "amount": 5000,
                "payment_type": "stage",
                "stage_id": "stage-post-commit",
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    assert "payment inline delivery deferred" in caplog.text
    assert take_client_write_side_effect(
        "notification",
        match_key="customer-post-commit",
    ) is None
    assert payment_transition_side_effects_suppressed() is False

    async with sess.SessionLocal() as db:
        assert (await db.scalar(select(func.count()).select_from(Payment))) == 1
        assert (await db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
        assert (await db.scalar(select(func.count()).select_from(AppNotification))) == 0

        assert await outbox_service.dispatch_pending(db, worker_id="create-recovery") == 1
        assert (await db.scalar(select(func.count()).select_from(AppNotification))) == 1
        outbox = (await db.execute(select(DomainOutbox))).scalar_one()
        assert outbox.processed_at is not None


async def test_payment_confirm_survives_inline_notification_failure_without_replay(
    monkeypatch,
    caplog,
):
    async with sess.SessionLocal() as db:
        db.add(
            Payment(
                id="payment-post-commit",
                project_id="project-post-commit",
                stage_id="stage-post-commit",
                payment_type=PaymentType.stage,
                status=PaymentStatus.pending,
                title="Оплата этапа",
                amount=5000,
                created_by="contractor-post-commit",
            )
        )
        await db.commit()

    monkeypatch.setattr(
        notification_service,
        "notify",
        AsyncMock(side_effect=RuntimeError("push_delivery_failed")),
    )
    monkeypatch.setattr(
        notification_service,
        "send_push",
        AsyncMock(return_value=True),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/projects/project-post-commit/payments/payment-post-commit/confirm",
            headers={"X-User-Id": "customer-post-commit"},
            json={"transfer_ack": True},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "paid_unverified"
    assert "payment inline delivery deferred" in caplog.text
    assert take_client_write_side_effect("activity") is None
    assert take_client_write_side_effect(
        "notification",
        match_key="contractor-post-commit",
    ) is None
    assert payment_transition_side_effects_suppressed() is False

    async with sess.SessionLocal() as db:
        payment = await db.get(Payment, "payment-post-commit")
        assert payment is not None
        assert payment.status == PaymentStatus.paid_unverified
        assert (await db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
        assert (await db.scalar(select(func.count()).select_from(DomainOutbox))) == 2
        assert (await db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
        assert (await db.scalar(select(func.count()).select_from(AppNotification))) == 0

        assert await outbox_service.dispatch_pending(db, worker_id="confirm-recovery") == 2
        assert (await db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
        assert (await db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
        assert (await db.scalar(select(func.count()).select_from(AppNotification))) == 1
        assert (
            await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.processed_at.is_not(None)
                )
            )
        ) == 2
