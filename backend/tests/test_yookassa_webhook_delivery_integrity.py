from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import subscription
from app.api.v1 import subscription_integrity
from app.db.base import Base
from app.models.entities import PaymentWebhookEvent
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.webhook_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.webhook_runtime import PaymentWebhookDelivery
from app.services import yookassa_service


class FakeRequest:
    def __init__(self, body: dict, *, secret: str | None = None):
        self._body = body
        self.client = SimpleNamespace(host="127.0.0.1")
        self.headers = {"X-Webhook-Secret": secret} if secret else {}

    async def json(self):
        return self._body


@pytest_asyncio.fixture
async def webhook_db():
    yookassa_service._seen_keys.clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    yookassa_service._seen_keys.clear()
    await engine.dispose()


def provider_body(event: str, *, object_id: str = "yk-shared-object") -> dict:
    status = "canceled" if event == "payment.canceled" else "succeeded"
    return {
        "event": event,
        "object": {
            "id": object_id,
            "status": status,
            "amount": {"value": "5000.00", "currency": "RUB"},
        },
    }


def test_event_identity_includes_event_type():
    succeeded = yookassa_service.webhook_event_key(provider_body("payment.succeeded"))
    cancelled = yookassa_service.webhook_event_key(provider_body("payment.canceled"))
    assert succeeded == "payment.succeeded:yk-shared-object"
    assert cancelled == "payment.canceled:yk-shared-object"
    assert succeeded != cancelled


def test_long_event_identity_is_bounded_and_stable():
    body = provider_body("refund.succeeded", object_id="x" * 300)
    first = yookassa_service.webhook_event_key(body)
    second = yookassa_service.webhook_event_key(body)
    assert first == second
    assert first and first.startswith("yk:")
    assert len(first) <= 128


@pytest.mark.asyncio
async def test_processing_failure_does_not_consume_delivery(webhook_db, monkeypatch):
    body = provider_body("payment.succeeded", object_id="yk-failure")

    async def fail_processing(_body, _db):
        raise RuntimeError("transient database failure")

    monkeypatch.setattr(subscription, "process_webhook", fail_processing)
    with pytest.raises(RuntimeError, match="transient database failure"):
        await subscription.yookassa_webhook(FakeRequest(body), webhook_db)

    assert (await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent))) == 0
    attempts, locked_by, completed_at = (
        await webhook_db.execute(
            select(
                PaymentWebhookDelivery.attempts,
                PaymentWebhookDelivery.locked_by,
                PaymentWebhookDelivery.completed_at,
            ).where(PaymentWebhookDelivery.event_id == "payment.succeeded:yk-failure")
        )
    ).one()
    assert attempts == 1
    assert locked_by is None
    assert completed_at is None
    assert not await yookassa_service.was_webhook_processed(
        webhook_db,
        "payment.succeeded:yk-failure",
    )


@pytest.mark.asyncio
async def test_retryable_result_returns_non_2xx_without_consuming_event(webhook_db, monkeypatch):
    body = provider_body("payment.succeeded", object_id="yk-deferred")

    async def defer_processing(_body, _db):
        return {
            "ok": True,
            "handled": False,
            "retryable": True,
            "blocked": "acceptance_required",
        }

    monkeypatch.setattr(subscription, "process_webhook", defer_processing)
    with pytest.raises(HTTPException) as exc_info:
        await subscription.yookassa_webhook(FakeRequest(body), webhook_db)

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "webhook_processing_deferred"
    assert (await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent))) == 0
    attempts = await webhook_db.scalar(
        select(PaymentWebhookDelivery.attempts).where(
            PaymentWebhookDelivery.event_id == "payment.succeeded:yk-deferred"
        )
    )
    assert attempts == 1


@pytest.mark.asyncio
async def test_success_records_completion_and_replay_skips_business_logic(webhook_db, monkeypatch):
    body = provider_body("payment.succeeded", object_id="yk-once")
    calls = 0

    async def process_once(_body, _db):
        nonlocal calls
        calls += 1
        return {"ok": True, "handled": True, "confirmed": True, "payment_id": "payment-1"}

    monkeypatch.setattr(subscription, "process_webhook", process_once)
    first = await subscription.yookassa_webhook(FakeRequest(body), webhook_db)
    second = await subscription.yookassa_webhook(FakeRequest(body), webhook_db)

    assert first["event_key"] == "payment.succeeded:yk-once"
    assert first["accepted"] is True
    assert first["business_applied"] is True
    assert second == {
        "ok": True,
        "accepted": True,
        "business_applied": False,
        "duplicate": True,
        "event_key": "payment.succeeded:yk-once",
    }
    assert calls == 1
    rows = (await webhook_db.execute(select(PaymentWebhookEvent))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload_kind == "payment.succeeded"
    outcome = await webhook_db.scalar(
        select(PaymentWebhookDelivery.outcome).where(
            PaymentWebhookDelivery.event_id == "payment.succeeded:yk-once"
        )
    )
    assert outcome == "handled"


@pytest.mark.asyncio
async def test_success_and_cancellation_for_same_provider_object_are_independent(webhook_db, monkeypatch):
    calls: list[str] = []

    async def process_event(body, _db):
        calls.append(body["event"])
        return {"ok": True, "handled": True, "changed": True}

    monkeypatch.setattr(subscription, "process_webhook", process_event)
    succeeded = await subscription.yookassa_webhook(
        FakeRequest(provider_body("payment.succeeded")),
        webhook_db,
    )
    cancelled = await subscription.yookassa_webhook(
        FakeRequest(provider_body("payment.canceled")),
        webhook_db,
    )

    assert succeeded["event_key"] == "payment.succeeded:yk-shared-object"
    assert cancelled["event_key"] == "payment.canceled:yk-shared-object"
    assert calls == ["payment.succeeded", "payment.canceled"]
    keys = set((await webhook_db.execute(select(PaymentWebhookEvent.event_id))).scalars().all())
    assert keys == {
        "payment.succeeded:yk-shared-object",
        "payment.canceled:yk-shared-object",
    }


@pytest.mark.asyncio
async def test_unsupported_project_partial_refund_stays_unacknowledged_for_reconciliation(
    webhook_db, monkeypatch,
):
    """Canonical webhook must not mark a money-moving partial refund as ignored/completed."""
    body = {
        "event": "refund.succeeded",
        "object": {
            "id": "refund-partial-748",
            "status": "succeeded",
            "payment_id": "provider-project-748",
            "amount": {"value": "1000.00", "currency": "RUB"},
        },
    }

    async def not_a_subscription(_body, _db):
        return None

    async def unsupported_project_refund(_body, _db):
        return {"ok": True, "handled": False, "reason": "partial_refund_unsupported"}

    monkeypatch.setattr(subscription_integrity, "_process_subscription_event", not_a_subscription)
    monkeypatch.setattr(subscription_integrity.yk, "process_webhook", unsupported_project_refund)

    with pytest.raises(HTTPException) as exc:
        await subscription_integrity.yookassa_webhook(FakeRequest(body), webhook_db)

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "webhook_processing_deferred"
    assert exc.value.detail["reason"] == "partial_refund_unsupported"
    assert (await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent))) == 0

    event_id = "refund.succeeded:refund-partial-748"
    delivery = await webhook_db.get(PaymentWebhookDelivery, event_id)
    assert delivery is not None
    assert delivery.attempts == 1
    assert delivery.completed_at is None
    assert delivery.locked_by is None
    assert "partial_refund_unsupported" in (delivery.last_error or "")


@pytest.mark.asyncio
async def test_real_project_partial_refund_webhook_preserves_ledger_and_remains_deferred(webhook_db):
    """Exercise the actual reversal service through the canonical webhook, not a mock."""
    from tests.test_yookassa_reversal_integrity import seed_payment, seed_project
    from app.models.entities import DomainOutbox, Expense, Payment, PaymentEvent, PaymentStatus, Project

    _, contractor, project, stage = await seed_project(webhook_db, "748")
    payment = await seed_payment(
        webhook_db,
        payment_id="gp5-partial-748",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.confirmed,
        provider_id="provider-gp5-partial-748",
        accepted=True,
    )
    # The canonical handler rolls the session back on a deferred provider event.
    # Keep immutable IDs outside ORM objects before that rollback expires them.
    payment_id = payment.id
    project_id = project.id
    body = {
        "event": "refund.succeeded",
        "object": {
            "id": "provider-refund-partial-748",
            "status": "succeeded",
            "payment_id": "provider-gp5-partial-748",
            "amount": {"value": "1000.00", "currency": "RUB"},
        },
    }
    with pytest.raises(HTTPException) as exc:
        await subscription_integrity.yookassa_webhook(FakeRequest(body), webhook_db)
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "webhook_processing_deferred"
    assert exc.value.detail["reason"] == "partial_refund_unsupported"

    stored_payment = await webhook_db.get(Payment, payment_id)
    stored_project = await webhook_db.get(Project, project_id)
    expense_rows = (await webhook_db.execute(
        select(Expense).where(Expense.payment_id == payment_id)
    )).scalars().all()
    assert stored_payment.status == PaymentStatus.confirmed
    assert stored_project.budget_spent == 5000
    assert len(expense_rows) == 1
    assert expense_rows[0].status == "confirmed"
    assert expense_rows[0].amount == 5000
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentEvent)) == 0
    assert await webhook_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent)) == 0

    event_id = "refund.succeeded:provider-refund-partial-748"
    delivery = await webhook_db.get(PaymentWebhookDelivery, event_id)
    assert delivery is not None
    assert delivery.attempts == 1
    assert delivery.completed_at is None
    assert delivery.locked_by is None
    assert "partial_refund_unsupported" in (delivery.last_error or "")

    # An immediate redelivery must not turn an unresolved money movement into 2xx.
    with pytest.raises(HTTPException) as retry:
        await subscription_integrity.yookassa_webhook(FakeRequest(body), webhook_db)
    assert retry.value.status_code == 503
    assert retry.value.detail["code"] in {
        "webhook_delivery_busy", "webhook_processing_deferred",
    }
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent)) == 0


@pytest.mark.asyncio
async def test_real_project_full_refund_webhook_commits_once_and_replay_is_noop(webhook_db):
    """Negative partial guard must not break supported full reversal effects."""
    from tests.test_yookassa_reversal_integrity import seed_payment, seed_project
    from app.models.entities import DomainOutbox, Expense, Payment, PaymentEvent, PaymentStatus, Project

    _, contractor, project, stage = await seed_project(webhook_db, "749")
    payment = await seed_payment(
        webhook_db,
        payment_id="gp5-full-749",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.confirmed,
        provider_id="provider-gp5-full-749",
        accepted=True,
    )
    body = {
        "event": "refund.succeeded",
        "object": {
            "id": "provider-refund-full-749",
            "status": "succeeded",
            "payment_id": "provider-gp5-full-749",
            "amount": {"value": "5000.00", "currency": "RUB"},
        },
    }
    applied = await subscription_integrity.yookassa_webhook(FakeRequest(body), webhook_db)
    assert applied["accepted"] is True
    assert applied["business_applied"] is True
    assert await webhook_db.get(Payment, payment.id) is not None
    assert (await webhook_db.get(Payment, payment.id)).status == PaymentStatus.refunded
    assert (await webhook_db.get(Project, project.id)).budget_spent == 0
    expense_rows = (await webhook_db.execute(
        select(Expense).where(Expense.payment_id == payment.id)
    )).scalars().all()
    assert len(expense_rows) == 1
    assert expense_rows[0].status == "refund"
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
    outbox_count = await webhook_db.scalar(select(func.count()).select_from(DomainOutbox))
    assert outbox_count == 3
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentWebhookEvent)) == 1
    delivery = await webhook_db.get(PaymentWebhookDelivery, "refund.succeeded:provider-refund-full-749")
    assert delivery.completed_at is not None

    again = await subscription_integrity.yookassa_webhook(FakeRequest(body), webhook_db)
    assert again["duplicate"] is True
    assert again["business_applied"] is False
    assert await webhook_db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
    assert await webhook_db.scalar(select(func.count()).select_from(DomainOutbox)) == outbox_count
