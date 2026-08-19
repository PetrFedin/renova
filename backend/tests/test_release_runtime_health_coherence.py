"""Operational surfaces must report one runtime truth for shared dependencies."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.api.v1 import admin as admin_api
from app.api.v1 import automation_worker as worker_api
from app.core.config import settings
from app.services import (
    automation_reminders_worker,
    otp_redis_recovery,
    outbox_dead_letter_service,
    push_receipt_service,
)
from app.services.runtime_health_truth import automation_worker_runtime_truth


def _push_receipt_snapshot() -> dict[str, object]:
    return {
        "pending": 0,
        "due": 0,
        "reconciled": 0,
        "terminal_errors": 0,
        "expired": 0,
        "active_leases": 0,
        "stale_leases": 0,
        "oldest_pending_age_seconds": None,
        "last_checked_at": None,
        "max_batch_size": 1000,
    }


@pytest.mark.parametrize(
    ("metrics", "expected_status"),
    [
        ({"consecutive_failures": 0, "outbox_status": "critical"}, "critical"),
        ({"consecutive_failures": 0, "outbox_status": "degraded"}, "degraded"),
        ({"consecutive_failures": 0, "outbox_status": "unknown"}, "unknown"),
        ({"consecutive_failures": 3, "outbox_status": "healthy"}, "critical"),
        ({"consecutive_failures": 0, "outbox_status": "healthy"}, "healthy"),
    ],
)
def test_shared_worker_classifier_covers_tick_and_outbox_truth(metrics, expected_status):
    truth = automation_worker_runtime_truth(metrics)

    assert truth["status"] == expected_status
    assert truth["healthy"] is (expected_status == "healthy")


@pytest.mark.asyncio
async def test_release_health_and_worker_endpoint_cannot_diverge(monkeypatch):
    metrics = {
        "consecutive_failures": 0,
        "outbox_status": "critical",
        "outbox_health": {"poisoned": 2},
    }
    otp_snapshot = {
        "healthy": False,
        "status": "critical",
        "required": True,
        "configured": True,
        "connected": False,
        "failed": True,
        "failure_count": 2,
        "retry_after_seconds": 2,
    }

    monkeypatch.setattr(worker_api, "automation_worker_metrics", lambda: dict(metrics))
    monkeypatch.setattr(
        automation_reminders_worker,
        "automation_worker_metrics",
        lambda: dict(metrics),
    )
    monkeypatch.setattr(
        otp_redis_recovery,
        "recovery_snapshot",
        lambda: dict(otp_snapshot),
    )
    monkeypatch.setattr(
        outbox_dead_letter_service,
        "runtime_health",
        AsyncMock(return_value={"status": "critical", "poisoned": 2}),
    )
    monkeypatch.setattr(
        push_receipt_service,
        "runtime_snapshot",
        AsyncMock(return_value=_push_receipt_snapshot()),
    )

    worker_response = await worker_api.automation_worker_status(_user=object())
    release_response = await admin_api.release_health(user=object(), db=object())
    release_worker = release_response["integrations"]["automation_worker"]

    for key in ("healthy", "status", "tick_healthy", "outbox_healthy"):
        assert release_worker[key] == worker_response[key]
    assert release_worker["status"] == "critical"
    assert release_worker["healthy"] is False
    assert release_response["integrations"]["otp_store"] == otp_snapshot
    assert release_response["integrations"]["push_receipts"] == {
        "worker_enabled": settings.push_receipt_worker_enabled,
        **_push_receipt_snapshot(),
    }


@pytest.mark.asyncio
async def test_release_health_otp_snapshot_is_bounded_and_secret_free(monkeypatch):
    snapshot = {
        "healthy": True,
        "status": "healthy",
        "required": True,
        "configured": True,
        "connected": True,
        "failed": False,
        "failure_count": 0,
        "retry_after_seconds": 0,
    }
    monkeypatch.setattr(
        automation_reminders_worker,
        "automation_worker_metrics",
        lambda: {"consecutive_failures": 0, "outbox_status": "healthy"},
    )
    monkeypatch.setattr(otp_redis_recovery, "recovery_snapshot", lambda: dict(snapshot))
    monkeypatch.setattr(
        outbox_dead_letter_service,
        "runtime_health",
        AsyncMock(return_value={"status": "healthy"}),
    )
    monkeypatch.setattr(
        push_receipt_service,
        "runtime_snapshot",
        AsyncMock(return_value=_push_receipt_snapshot()),
    )

    response = await admin_api.release_health(user=object(), db=object())
    otp_store = response["integrations"]["otp_store"]

    assert otp_store == snapshot
    serialized = str(otp_store).lower()
    assert "redis://" not in serialized
    assert "url" not in otp_store
    assert "error" not in otp_store
    assert "exception" not in otp_store
