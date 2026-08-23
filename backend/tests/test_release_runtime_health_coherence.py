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
    provider_reconciliation_service,
    push_receipt_service,
    runtime_topology,
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


def _provider_reconciliation_snapshot() -> dict[str, object]:
    return {
        "providers": {},
        "pending_total": 0,
        "terminal_total": 0,
    }


def _worker_pool(status: str = "healthy") -> dict[str, object]:
    return {
        "required": True,
        "configured": True,
        "runtime_owner": "renova-worker",
        "healthy": status == "healthy",
        "status": status,
        "current_release": "sha",
        "live_instances": 1 if status != "missing" else 0,
        "matching_release_instances": 1 if status == "healthy" else 0,
        "workers": [],
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
def test_shared_manual_tick_classifier_covers_tick_and_outbox_truth(metrics, expected_status):
    truth = automation_worker_runtime_truth(metrics)

    assert truth["status"] == expected_status
    assert truth["healthy"] is (expected_status == "healthy")


@pytest.mark.asyncio
async def test_release_health_and_worker_endpoint_share_worker_pool_truth(monkeypatch):
    metrics = {
        "consecutive_failures": 0,
        "outbox_status": "critical",
        "outbox_health": {"poisoned": 2},
    }
    pool = _worker_pool("healthy")
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
    monkeypatch.setattr(worker_api, "worker_pool_snapshot", AsyncMock(return_value=dict(pool)))
    monkeypatch.setattr(
        automation_reminders_worker,
        "automation_worker_metrics",
        lambda: dict(metrics),
    )
    monkeypatch.setattr(
        runtime_topology,
        "worker_pool_snapshot",
        AsyncMock(return_value=dict(pool)),
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
    monkeypatch.setattr(
        provider_reconciliation_service,
        "runtime_snapshot",
        AsyncMock(return_value=_provider_reconciliation_snapshot()),
    )

    worker_response = await worker_api.automation_worker_status(_user=object())
    release_response = await admin_api.release_health(user=object(), db=object())
    release_worker = release_response["integrations"]["automation_worker"]

    assert release_worker["worker_pool"] == worker_response["worker_pool"] == pool
    assert release_worker["status"] == worker_response["status"] == "healthy"
    assert release_worker["healthy"] is True
    assert release_worker["manual_tick"]["status"] == "critical"
    assert worker_response["manual_tick"]["status"] == "critical"
    assert release_response["runtime_topology"]["api"]["background_jobs_embedded"] is False
    assert release_response["runtime_topology"]["worker_pool"] == pool
    assert release_response["integrations"]["otp_store"] == otp_snapshot
    assert release_response["integrations"]["push_receipts"] == {
        "runtime_owner": "renova-worker",
        "worker_enabled": settings.push_receipt_worker_enabled,
        **_push_receipt_snapshot(),
    }
    assert release_response["integrations"]["provider_reconciliation"] == {
        "runtime_owner": "renova-worker",
        "healthy": True,
        "status": "healthy",
        "recovery_ready": True,
        **_provider_reconciliation_snapshot(),
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
        runtime_topology,
        "worker_pool_snapshot",
        AsyncMock(return_value=_worker_pool()),
    )
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
    monkeypatch.setattr(
        provider_reconciliation_service,
        "runtime_snapshot",
        AsyncMock(return_value=_provider_reconciliation_snapshot()),
    )

    response = await admin_api.release_health(user=object(), db=object())
    otp_store = response["integrations"]["otp_store"]

    assert otp_store == snapshot
    serialized = str(otp_store).lower()
    assert "redis://" not in serialized
    assert "url" not in otp_store
    assert "error" not in otp_store
    assert "exception" not in otp_store
