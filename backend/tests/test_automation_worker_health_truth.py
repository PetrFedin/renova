"""Automation worker API must separate tick execution from runtime health."""
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.api.v1 import automation_worker as api

pytestmark = pytest.mark.asyncio


async def test_status_is_critical_when_outbox_is_critical(monkeypatch):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {
            "consecutive_failures": 0,
            "outbox_status": "critical",
            "outbox_health": {"poisoned": 1},
        },
    )

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is False
    assert response["status"] == "critical"
    assert response["tick_healthy"] is True
    assert response["outbox_healthy"] is False
    assert response["outbox_health"] == {"poisoned": 1}


async def test_status_is_degraded_for_aging_outbox(monkeypatch):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {
            "consecutive_failures": 0,
            "outbox_status": "degraded",
        },
    )

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is False
    assert response["status"] == "degraded"
    assert response["tick_healthy"] is True
    assert response["outbox_healthy"] is False


async def test_status_is_unknown_before_first_outbox_observation(monkeypatch):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {
            "consecutive_failures": 0,
            "outbox_status": "unknown",
        },
    )

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is False
    assert response["status"] == "unknown"
    assert response["tick_healthy"] is True
    assert response["outbox_healthy"] is False


async def test_status_is_critical_after_failure_streak_even_with_healthy_outbox(monkeypatch):
    monkeypatch.setattr(
        api,
        "automation_worker_metrics",
        lambda: {
            "consecutive_failures": 3,
            "outbox_status": "healthy",
        },
    )

    response = await api.automation_worker_status(_user=object())

    assert response["healthy"] is False
    assert response["status"] == "critical"
    assert response["tick_healthy"] is False
    assert response["outbox_healthy"] is True


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
