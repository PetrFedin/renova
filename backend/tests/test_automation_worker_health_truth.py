"""Automation worker API must separate shared worker runtime from manual ticks."""
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.api.v1 import automation_worker as api

pytestmark = pytest.mark.asyncio


def _pool(status: str = "healthy") -> dict[str, object]:
    return {
        "required": True,
        "configured": True,
        "runtime_owner": "renova-worker",
        "healthy": status == "healthy",
        "status": status,
        "current_release": "sha",
        "live_instances": 1 if status in {"healthy", "release_mismatch"} else 0,
        "matching_release_instances": 1 if status == "healthy" else 0,
        "workers": [],
    }


async def test_status_uses_shared_worker_pool_not_api_local_metrics(monkeypatch):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {
            "consecutive_failures": 0,
            "outbox_status": "critical",
            "outbox_health": {"poisoned": 1},
        },
    )
    monkeypatch.setattr(api, "worker_pool_snapshot", AsyncMock(return_value=_pool("healthy")))

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is True
    assert response["status"] == "healthy"
    assert response["runtime_owner"] == "renova-worker"
    assert response["worker_pool"]["healthy"] is True
    assert response["manual_tick"]["status"] == "critical"
    assert response["manual_tick"]["outbox_health"] == {"poisoned": 1}


@pytest.mark.parametrize("pool_status", ["missing", "unavailable", "release_mismatch"])
async def test_status_fails_closed_for_worker_pool_gaps(monkeypatch, pool_status):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {"consecutive_failures": 0, "outbox_status": "healthy"},
    )
    monkeypatch.setattr(api, "worker_pool_snapshot", AsyncMock(return_value=_pool(pool_status)))

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is False
    assert response["status"] == pool_status
    assert response["manual_tick"]["healthy"] is True


async def test_manual_tick_reports_execution_but_not_success_for_critical_outbox(monkeypatch):
    run_tick = AsyncMock(
        return_value={
            "project_actions": 0,
            "waste_sent": 0,
            "reminders_enqueued": 0,
            "outbox_dispatched": 0,
            "outbox_status": "critical",
        }
    )
    record_ok = Mock()
    monkeypatch.setattr(api, "run_automation_reminder_tick", run_tick)
    monkeypatch.setattr(api, "_record_ok", record_ok)

    response = await api.automation_worker_tick(_user=object())

    assert response["tick_executed"] is True
    assert response["ok"] is False
    assert response["healthy"] is False
    assert response["status"] == "critical"
    assert response["code"] == "outbox_critical"
    assert response["runtime_owner"] == "manual_admin_tick"
    record_ok.assert_called_once_with(run_tick.return_value)


async def test_manual_tick_reports_healthy_success_only_for_healthy_outbox(monkeypatch):
    run_tick = AsyncMock(
        return_value={
            "project_actions": 1,
            "waste_sent": 0,
            "reminders_enqueued": 1,
            "outbox_dispatched": 1,
            "outbox_status": "healthy",
        }
    )
    monkeypatch.setattr(api, "run_automation_reminder_tick", run_tick)
    monkeypatch.setattr(api, "_record_ok", Mock())

    response = await api.automation_worker_tick(_user=object())

    assert response["tick_executed"] is True
    assert response["ok"] is True
    assert response["healthy"] is True
    assert response["status"] == "healthy"
    assert response["code"] is None


async def test_manual_tick_exception_remains_redacted_and_records_failure(monkeypatch):
    record_fail = Mock()
    monkeypatch.setattr(
        api,
        "run_automation_reminder_tick",
        AsyncMock(side_effect=RuntimeError("provider-secret-stack")),
    )
    monkeypatch.setattr(api, "_record_fail", record_fail)

    with pytest.raises(HTTPException) as raised:
        await api.automation_worker_tick(_user=object())

    assert raised.value.status_code == 500
    assert raised.value.detail == {"code": "automation_tick_failed"}
    assert "provider-secret-stack" not in str(raised.value.detail)
    record_fail.assert_called_once()
