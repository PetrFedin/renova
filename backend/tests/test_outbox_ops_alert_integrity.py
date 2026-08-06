"""Proactive operator alerting for degraded durable outbox state."""
from copy import deepcopy
from datetime import timedelta
from unittest.mock import AsyncMock
import uuid

import pytest
from sqlalchemy import select

from app.core import config
from app.core.timeutil import utc_now
from app.db import session as sess
from app.db.session import init_db
from app.models.entities import DomainOutbox
from app.models.outbox_runtime import DomainOutboxLease
from app.services import automation_reminders_worker as worker
from app.services import email_service, outbox_service

pytestmark = pytest.mark.asyncio


def _health(
    *,
    pending: int = 0,
    retryable: int = 0,
    poisoned: int = 0,
    stale_leases: int = 0,
    oldest_age: int | None = None,
) -> dict[str, object]:
    return {
        "pending": pending,
        "retryable": retryable,
        "poisoned": poisoned,
        "active_leases": 0,
        "stale_leases": stale_leases,
        "oldest_pending_age_seconds": oldest_age,
        "max_attempts": outbox_service.MAX_ATTEMPTS,
        # Deliberately unsafe fields must never reach an alert body.
        "payload_json": '{"secret":"must-not-leak"}',
        "last_error": "provider-password-must-not-leak",
        "event_id": "private-event-id-must-not-leak",
    }


@pytest.fixture(autouse=True)
def reset_alert_state():
    original_metrics = deepcopy(worker._METRICS)
    original_status = worker._outbox_alerted_status
    original_email = config.settings.ops_alert_email
    config.settings.ops_alert_email = "ops@example.com"
    worker._outbox_alerted_status = None
    worker._METRICS.update(
        {
            "outbox_status": "unknown",
            "outbox_health": None,
            "outbox_alerted_status": None,
            "outbox_alert_count": 0,
            "outbox_alert_last_action": None,
            "outbox_alert_last_status": None,
            "outbox_alert_last_at": None,
            "outbox_alert_last_error": None,
        }
    )
    yield
    worker._METRICS.clear()
    worker._METRICS.update(original_metrics)
    worker._outbox_alerted_status = original_status
    config.settings.ops_alert_email = original_email


async def test_outbox_alerts_once_escalates_and_recovers_without_spam(monkeypatch):
    send_alert = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_ops_alert_email", send_alert)

    degraded = _health(pending=3, retryable=3, oldest_age=301)
    critical = _health(pending=4, retryable=3, poisoned=1, oldest_age=601)
    healthy = _health()

    await worker._maybe_outbox_ops_alert(degraded)
    await worker._maybe_outbox_ops_alert(degraded)
    await worker._maybe_outbox_ops_alert(critical)
    # Improvement from critical to degraded is not recovery and must not spam.
    await worker._maybe_outbox_ops_alert(degraded)
    await worker._maybe_outbox_ops_alert(healthy)
    await worker._maybe_outbox_ops_alert(healthy)

    assert send_alert.await_count == 3
    subjects = [call.args[1] for call in send_alert.await_args_list]
    assert subjects == [
        "Renova ALERT: domain outbox degraded",
        "Renova ALERT: domain outbox critical",
        "Renova RECOVERY: domain outbox healthy",
    ]
    assert worker._METRICS["outbox_alert_count"] == 3
    assert worker._METRICS["outbox_status"] == "healthy"
    assert worker._METRICS["outbox_alerted_status"] is None


async def test_outbox_alert_retries_until_smtp_accepts(monkeypatch):
    send_alert = AsyncMock(side_effect=[False, True])
    monkeypatch.setattr(email_service, "send_ops_alert_email", send_alert)
    critical = _health(pending=1, poisoned=1, oldest_age=900)

    await worker._maybe_outbox_ops_alert(critical)
    assert worker._outbox_alerted_status is None
    assert worker._METRICS["outbox_alert_last_status"] == "preview"

    await worker._maybe_outbox_ops_alert(critical)
    assert send_alert.await_count == 2
    assert worker._outbox_alerted_status == "critical"
    assert worker._METRICS["outbox_alert_last_status"] == "sent"
    assert worker._METRICS["outbox_alert_count"] == 1


async def test_outbox_alert_body_contains_only_bounded_aggregates(monkeypatch):
    send_alert = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_ops_alert_email", send_alert)

    await worker._maybe_outbox_ops_alert(
        _health(pending=2, retryable=1, poisoned=1, stale_leases=1, oldest_age=777)
    )

    body = send_alert.await_args.args[2]
    assert "pending=2" in body
    assert "poisoned=1" in body
    assert "stale_leases=1" in body
    assert "/admin/outbox-dead-letters" in body
    assert "must-not-leak" not in body
    assert "payload_json" not in body
    assert "last_error" not in body
    assert "event_id" not in body


async def test_successful_tick_alerts_for_poisoned_row_even_when_dispatch_returns_zero(
    tmp_path,
    monkeypatch,
):
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'outbox-ops-alert.db'}"
    engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    session_factory = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(config.settings, "database_url", database_url)
    monkeypatch.setattr(sess, "engine", engine)
    monkeypatch.setattr(sess, "SessionLocal", session_factory)
    await init_db()

    outbox_id = str(uuid.uuid4())
    async with sess.SessionLocal() as db:
        db.add(
            DomainOutbox(
                id=outbox_id,
                aggregate_type="test",
                aggregate_id="bounded-aggregate",
                event_type="test.poisoned",
                payload_json='{"api_key":"super-secret"}',
                attempts=outbox_service.MAX_ATTEMPTS,
                last_error="provider-secret-stack-trace",
                created_at=utc_now() - timedelta(minutes=20),
            )
        )
        db.add(DomainOutboxLease(outbox_id=outbox_id))
        await db.commit()

    send_alert = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_ops_alert_email", send_alert)
    try:
        result = await worker.run_automation_reminder_tick()

        assert result["outbox_dispatched"] == 0
        assert result["outbox_status"] == "critical"
        send_alert.assert_awaited_once()
        body = send_alert.await_args.args[2]
        assert "poisoned=1" in body
        assert "super-secret" not in body
        assert "provider-secret-stack-trace" not in body

        async with sess.SessionLocal() as db:
            row = await db.get(DomainOutbox, outbox_id)
            assert row is not None
            assert row.processed_at is None
            assert row.attempts == outbox_service.MAX_ATTEMPTS
            assert (
                await db.scalar(
                    select(DomainOutbox.id).where(DomainOutbox.id == outbox_id)
                )
            ) == outbox_id
    finally:
        await engine.dispose()
