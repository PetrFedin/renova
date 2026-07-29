from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import subscription
from app.db.base import Base
from app.models.entities import PaymentWebhookEvent
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
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
    assert second == {
        "ok": True,
        "duplicate": True,
        "event_key": "payment.succeeded:yk-once",
    }
    assert calls == 1
    rows = (await webhook_db.execute(select(PaymentWebhookEvent))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload_kind == "payment.succeeded"


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
