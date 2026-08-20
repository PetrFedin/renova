from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import subscription
from app.core.config import settings
from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import (
    Payment,
    PaymentStatus,
    PaymentType,
    PaymentWebhookEvent,
    Project,
    Stage,
    Subscription,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.webhook_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.webhook_runtime import PaymentWebhookDelivery
from app.services import payment_service, yookassa_service
from app.services.webhook_delivery_service import (
    LEASE_TTL,
    claim_delivery,
    complete_delivery,
)


class FakeRequest:
    def __init__(
        self,
        body: dict,
        *,
        secret: str | None = None,
        host: str = "127.0.0.1",
        correlation_id: str | None = None,
    ):
        self._body = body
        self.client = SimpleNamespace(host=host)
        self.headers = {}
        if secret is not None:
            self.headers["X-Webhook-Secret"] = secret
        if correlation_id is not None:
            self.headers["X-Correlation-ID"] = correlation_id

    async def json(self):
        return self._body


@pytest_asyncio.fixture
async def webhook_store(tmp_path):
    yookassa_service._seen_keys.clear()
    db_path = tmp_path / "yookassa-claim.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield engine, session_factory
    yookassa_service._seen_keys.clear()
    await engine.dispose()


def subscription_body(
    user_id: str,
    *,
    object_id: str,
    amount: str = "990.00",
    currency: str = "RUB",
    kind: str = "pro_subscription",
) -> dict:
    return {
        "event": "payment.succeeded",
        "object": {
            "id": object_id,
            "status": "succeeded",
            "amount": {"value": amount, "currency": currency},
            "metadata": {"kind": kind, "user_id": user_id},
        },
    }


async def seed_user(
    session_factory,
    *,
    user_id: str,
    phone: str,
    role: UserRole,
) -> None:
    async with session_factory() as db:
        db.add(User(id=user_id, phone=phone, role=role))
        await db.commit()


def test_alembic_graph_has_one_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == ["w13ormparity01"]
    push_receipt_revision = script.get_revision("w12pushreceipt01")
    assert push_receipt_revision is not None
    assert push_receipt_revision.down_revision == "w11refundreview01"
    review_revision = script.get_revision("w11refundreview01")
    assert review_revision is not None
    assert review_revision.down_revision == "w10subscriptionrefund01"
    refund_revision = script.get_revision("w10subscriptionrefund01")
    assert refund_revision is not None
    assert refund_revision.down_revision == "w9subscriptioncheckout01"
    checkout_revision = script.get_revision("w9subscriptioncheckout01")
    assert checkout_revision is not None
    assert checkout_revision.down_revision == "w8calendarintegrity01"
    calendar_revision = script.get_revision("w8calendarintegrity01")
    assert calendar_revision is not None
    assert calendar_revision.down_revision == "w6webhookdelivery01"


@pytest.mark.asyncio
async def test_missing_provider_object_id_is_rejected_before_claim(webhook_store):
    _engine, session_factory = webhook_store
    await seed_user(
        session_factory,
        user_id="missing-id-contractor",
        phone="+79990004001",
        role=UserRole.contractor,
    )
    body = subscription_body("missing-id-contractor", object_id="")
    async with session_factory() as db:
        with pytest.raises(HTTPException) as exc_info:
            await subscription.yookassa_webhook(FakeRequest(body), db)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "missing_provider_object_id"

    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(PaymentWebhookDelivery)) == 0
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "amount", "currency", "kind", "reason"),
    [
        (UserRole.contractor, "1.00", "RUB", "pro_subscription", "amount_mismatch"),
        (UserRole.contractor, "990.00", "USD", "pro_subscription", "currency_mismatch"),
        (UserRole.customer, "990.00", "RUB", "pro_subscription", "subscription_role_forbidden"),
        (UserRole.contractor, "990.00", "RUB", "", "unsupported_payment_kind"),
    ],
)
async def test_invalid_subscription_settlement_is_recorded_without_activation(
    webhook_store,
    role,
    amount,
    currency,
    kind,
    reason,
):
    _engine, session_factory = webhook_store
    suffix = reason.replace("_", "-")
    user_id = f"sub-{suffix}"
    await seed_user(
        session_factory,
        user_id=user_id,
        phone=f"+7999{abs(hash(reason)) % 10000000:07d}",
        role=role,
    )
    body = subscription_body(
        user_id,
        object_id=f"yk-{suffix}",
        amount=amount,
        currency=currency,
        kind=kind,
    )

    async with session_factory() as db:
        result = await subscription.yookassa_webhook(FakeRequest(body), db)
    assert result["accepted"] is True
    assert result["business_applied"] is False
    assert result["reason"] == reason

    event_key = f"payment.succeeded:yk-{suffix}"
    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 0
        outcome = await db.scalar(
            select(PaymentWebhookDelivery.outcome).where(
                PaymentWebhookDelivery.event_id == event_key
            )
        )
        assert outcome == f"ignored:{reason}"
        assert await db.get(PaymentWebhookEvent, event_key) is not None


@pytest.mark.asyncio
async def test_valid_subscription_is_activated_once_and_replay_is_duplicate(webhook_store):
    _engine, session_factory = webhook_store
    await seed_user(
        session_factory,
        user_id="valid-contractor",
        phone="+79990004002",
        role=UserRole.contractor,
    )
    body = subscription_body("valid-contractor", object_id="yk-valid-pro")

    async with session_factory() as db:
        first = await subscription.yookassa_webhook(FakeRequest(body), db)
    async with session_factory() as db:
        second = await subscription.yookassa_webhook(FakeRequest(body), db)

    assert first["business_applied"] is True
    assert first["pro_user_id"] == "valid-contractor"
    assert second["duplicate"] is True
    assert second["business_applied"] is False

    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == "valid-contractor")
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].plan == "pro"
        assert rows[0].status.value == "active"
        assert await db.scalar(select(func.count()).select_from(PaymentWebhookEvent)) == 1


@pytest.mark.asyncio
async def test_active_claim_blocks_concurrent_business_execution(webhook_store, monkeypatch):
    _engine, session_factory = webhook_store
    body = subscription_body("concurrent-contractor", object_id="yk-concurrent")
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def slow_process(_body, _db):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return {"ok": True, "handled": True}

    monkeypatch.setattr(subscription, "process_webhook", slow_process)

    async def deliver(correlation_id: str):
        async with session_factory() as db:
            return await subscription.yookassa_webhook(
                FakeRequest(body, correlation_id=correlation_id),
                db,
            )

    first_task = asyncio.create_task(deliver("delivery-a"))
    await asyncio.wait_for(entered.wait(), timeout=5)
    with pytest.raises(HTTPException) as exc_info:
        await deliver("delivery-b")
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "webhook_delivery_busy"

    release.set()
    first = await first_task
    replay = await deliver("delivery-c")
    assert first["business_applied"] is True
    assert replay["duplicate"] is True
    assert calls == 1


@pytest.mark.asyncio
async def test_stale_owner_cannot_commit_business_after_reclaim(webhook_store):
    _engine, session_factory = webhook_store
    event_id = "payment.succeeded:yk-stale-owner"

    async with session_factory() as db:
        first = await claim_delivery(
            db,
            event_id=event_id,
            event_kind="payment.succeeded",
            worker_id="first-worker",
        )
    assert first.status == "acquired" and first.token

    async with session_factory() as db:
        await db.execute(
            update(PaymentWebhookDelivery)
            .where(PaymentWebhookDelivery.event_id == event_id)
            .values(locked_at=utc_now() - LEASE_TTL - timedelta(seconds=1))
        )
        await db.commit()

    async with session_factory() as db:
        second = await claim_delivery(
            db,
            event_id=event_id,
            event_kind="payment.succeeded",
            worker_id="second-worker",
        )
    assert second.status == "acquired" and second.token
    assert second.token != first.token

    async with session_factory() as db:
        db.add(
            User(
                id="must-rollback-user",
                phone="+79990004003",
                role=UserRole.contractor,
            )
        )
        committed = await complete_delivery(
            db,
            event_id=event_id,
            claim_token=first.token,
            event_kind="payment.succeeded",
            outcome="handled",
        )
    assert committed is False

    async with session_factory() as db:
        assert await db.get(User, "must-rollback-user") is None
        assert await complete_delivery(
            db,
            event_id=event_id,
            claim_token=second.token,
            event_kind="payment.succeeded",
            outcome="handled",
        ) is True


@pytest.mark.asyncio
async def test_project_provider_id_attach_rolls_back_when_confirmation_fails(
    webhook_store,
    monkeypatch,
):
    _engine, session_factory = webhook_store
    async with session_factory() as db:
        customer = User(
            id="rollback-customer",
            phone="+79990004004",
            role=UserRole.customer,
        )
        contractor = User(
            id="rollback-contractor",
            phone="+79990004005",
            role=UserRole.contractor,
        )
        project = Project(
            id="rollback-project",
            name="Webhook rollback",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
        )
        stage = Stage(
            id="rollback-stage",
            project_id=project.id,
            name="Stage",
            sort_order=1,
        )
        payment = Payment(
            id="rollback-payment",
            project_id=project.id,
            stage_id=stage.id,
            payment_type=PaymentType.stage,
            status=PaymentStatus.pending,
            title="Rollback payment",
            amount=5000,
            created_by=contractor.id,
        )
        db.add_all([customer, contractor, project, stage, payment])
        await db.commit()

    async def fail_confirm(*_args, **_kwargs):
        raise RuntimeError("confirm-crashed")

    monkeypatch.setattr(payment_service, "confirm_payment", fail_confirm)
    body = {
        "event": "payment.succeeded",
        "object": {
            "id": "yk-rollback-payment",
            "status": "succeeded",
            "amount": {"value": "5000.00", "currency": "RUB"},
            "metadata": {
                "kind": "project_payment",
                "payment_id": "rollback-payment",
                "project_id": "rollback-project",
                "user_id": "rollback-customer",
            },
        },
    }

    async with session_factory() as db:
        with pytest.raises(RuntimeError, match="confirm-crashed"):
            await subscription.yookassa_webhook(FakeRequest(body), db)

    async with session_factory() as db:
        stored = await db.get(Payment, "rollback-payment")
        assert stored.status == PaymentStatus.pending
        assert stored.yookassa_payment_id is None
        assert await db.get(
            PaymentWebhookEvent,
            "payment.succeeded:yk-rollback-payment",
        ) is None
        attempts = await db.scalar(
            select(PaymentWebhookDelivery.attempts).where(
                PaymentWebhookDelivery.event_id == "payment.succeeded:yk-rollback-payment"
            )
        )
        assert attempts == 1


@pytest.mark.asyncio
async def test_secret_gate_rejects_before_delivery_claim(webhook_store, monkeypatch):
    _engine, session_factory = webhook_store
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "yookassa_webhook_secret", "s" * 40)
    body = subscription_body("nobody", object_id="yk-secret-rejected")

    async with session_factory() as db:
        with pytest.raises(HTTPException) as exc_info:
            await subscription.yookassa_webhook(
                FakeRequest(body, secret="x" * 40),
                db,
            )
    assert exc_info.value.status_code == 401

    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(PaymentWebhookDelivery)) == 0


def test_production_alias_uses_ip_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "environment", "prod")
    assert yookassa_service.check_webhook_ip("not-an-ip") is False
    assert yookassa_service.check_webhook_ip("185.71.76.1") is True
    assert yookassa_service.check_webhook_ip("127.0.0.1") is False
