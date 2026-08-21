from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.services import capacity_runtime_service as capacity


class FakePool:
    def __init__(self, *, size=5, checked_out=6, checked_in=4, overflow=1):
        self._size = size
        self._checked_out = checked_out
        self._checked_in = checked_in
        self._overflow = overflow

    def size(self):
        return self._size

    def checkedout(self):
        return self._checked_out

    def checkedin(self):
        return self._checked_in

    def overflow(self):
        return self._overflow


class FakeRedis:
    def __init__(self, *, ok=True, fail=False):
        self.ok = ok
        self.fail = fail

    async def ping(self):
        if self.fail:
            raise RuntimeError("redis://secret-host:6379/password")
        return self.ok


class FakeDb:
    def __init__(self, *, fail=False):
        self.fail = fail
        self.execute = AsyncMock(side_effect=RuntimeError("db-secret") if fail else None)


def test_postgres_pool_capacity_uses_reviewed_configured_denominator(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://redacted/db")
    monkeypatch.setattr(settings, "db_pool_size", 5)
    monkeypatch.setattr(settings, "db_max_overflow", 10)
    monkeypatch.setattr(settings, "db_pool_timeout_sec", 30.0)
    monkeypatch.setattr(capacity, "_api_instance_id", lambda: "api-test-instance")

    snapshot = capacity.database_pool_snapshot(FakePool())

    assert snapshot == {
        "scope": "api_process",
        "instance_id": "api-test-instance",
        "supported": True,
        "configured_pool_size": 5,
        "configured_max_overflow": 10,
        "configured_connection_capacity": 15,
        "pool_timeout_seconds": 30.0,
        "checked_out": 6,
        "checked_in": 4,
        "current_overflow": 1,
        "utilization_percent": 40.0,
    }


def test_sqlite_pool_does_not_claim_postgres_capacity(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "sqlite+aiosqlite:///./test.db")
    snapshot = capacity.database_pool_snapshot(FakePool())
    assert snapshot["supported"] is False
    assert snapshot["configured_connection_capacity"] is None
    assert snapshot["utilization_percent"] is None


def test_engine_options_make_postgres_capacity_explicit(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://redacted/db")
    monkeypatch.setattr(settings, "db_pool_size", 7)
    monkeypatch.setattr(settings, "db_max_overflow", 3)
    monkeypatch.setattr(settings, "db_pool_timeout_sec", 12.5)
    assert db_session._engine_options() == {
        "echo": False,
        "pool_size": 7,
        "max_overflow": 3,
        "pool_timeout": 12.5,
        "pool_pre_ping": True,
    }


@pytest.mark.asyncio
async def test_capacity_snapshot_is_secret_free_and_reuses_shared_topology(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://db-secret/db")
    monkeypatch.setattr(settings, "redis_url", "redis://redis-secret:6379/0")
    monkeypatch.setattr(settings, "db_pool_size", 5)
    monkeypatch.setattr(settings, "db_max_overflow", 10)
    monkeypatch.setattr(
        capacity,
        "database_pool_snapshot",
        lambda: {"supported": True, "instance_id": "api-local"},
    )
    worker_pool = {
        "healthy": True,
        "status": "healthy",
        "runtime_owner": "renova-worker",
        "workers": [],
    }
    api_pool = {
        "healthy": True,
        "status": "healthy",
        "runtime_owner": "renova-api",
        "live_instances": 2,
        "matching_release_instances": 2,
        "apis": [
            {"instance_id": "api-a", "database_pool": {"utilization_percent": 20}},
            {"instance_id": "api-b", "database_pool": {"utilization_percent": 30}},
        ],
    }

    snapshot = await capacity.capacity_runtime_snapshot(
        FakeDb(),
        worker_pool=worker_pool,
        api_pool=api_pool,
        redis_client=FakeRedis(),
    )

    assert snapshot["contract_version"] == 2
    assert snapshot["database"]["probe"]["available"] is True
    assert snapshot["database"]["probe"]["probe_latency_ms"] is not None
    assert snapshot["database"]["local_pool"] == {
        "supported": True,
        "instance_id": "api-local",
    }
    assert snapshot["api_pool"] == api_pool
    assert snapshot["redis"]["available"] is True
    assert snapshot["redis"]["probe_latency_ms"] is not None
    assert snapshot["worker_pool"] == worker_pool
    assert snapshot["interpretation"] == {
        "database_pool_scope": "shared_api_registry_plus_local_process",
        "redis_utilization_available": False,
        "provider_cpu_memory_available": False,
    }
    serialized = json.dumps(snapshot).lower()
    assert "db-secret" not in serialized
    assert "redis-secret" not in serialized
    assert "redis://" not in serialized


@pytest.mark.asyncio
async def test_capacity_probe_failures_are_bounded(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://secret/db")
    monkeypatch.setattr(settings, "redis_url", "redis://secret:6379/0")
    monkeypatch.setattr(capacity, "database_pool_snapshot", lambda: {"supported": True})

    snapshot = await capacity.capacity_runtime_snapshot(
        FakeDb(fail=True),
        worker_pool={"healthy": False, "status": "missing"},
        api_pool={"healthy": False, "status": "missing", "apis": []},
        redis_client=FakeRedis(fail=True),
    )

    assert snapshot["database"]["probe"] == {
        "available": False,
        "probe_latency_ms": None,
    }
    assert snapshot["redis"] == {
        "configured": True,
        "available": False,
        "probe_latency_ms": None,
    }
    serialized = json.dumps(snapshot).lower()
    assert "secret" not in serialized
    assert "exception" not in serialized
    assert "error" not in serialized
