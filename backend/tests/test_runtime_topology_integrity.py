from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from app import runtime_healthcheck
from app.core.config import settings
from app.services import capacity_runtime_service, runtime_topology


class FakeRedis:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values = dict(values or {})
        self.closed = False

    async def set(self, key, value, *, ex=None):
        assert ex in {
            runtime_topology.WORKER_HEARTBEAT_TTL_SEC,
            runtime_topology.API_HEARTBEAT_TTL_SEC,
        }
        self.values[str(key)] = str(value)
        return True

    async def delete(self, key):
        self.values.pop(str(key), None)
        return 1

    async def mget(self, keys):
        return [self.values.get(str(key)) for key in keys]

    async def scan_iter(self, *, match, count):
        del count
        prefix = match[:-1] if match.endswith("*") else match
        for key in sorted(self.values):
            if key.startswith(prefix):
                yield key

    async def aclose(self):
        self.closed = True


def _worker_payload(
    *,
    instance_id: str,
    release: str,
    artifact_digest: str = "sha256:test",
) -> str:
    return json.dumps(
        {
            "role": "worker",
            "status": "healthy",
            "instance_id": instance_id,
            "release": release,
            "artifact_digest": artifact_digest,
            "started_at": "2026-08-21T10:00:00+00:00",
            "heartbeat_at": "2026-08-21T10:00:05+00:00",
            "active_tasks": ["domain_outbox", "automation_reminders"],
        }
    )


def _api_payload(
    *,
    instance_id: str,
    release: str,
    artifact_digest: str = "sha256:test",
    utilization_percent: float = 20.0,
) -> str:
    return json.dumps(
        {
            "role": "api",
            "status": "healthy",
            "instance_id": instance_id,
            "release": release,
            "artifact_digest": artifact_digest,
            "started_at": "2026-08-21T10:00:00+00:00",
            "heartbeat_at": "2026-08-21T10:00:05+00:00",
            "database_pool": {
                "scope": "api_process",
                "instance_id": instance_id,
                "supported": True,
                "configured_pool_size": 5,
                "configured_max_overflow": 10,
                "configured_connection_capacity": 15,
                "pool_timeout_seconds": 30.0,
                "checked_out": 3,
                "checked_in": 2,
                "current_overflow": 0,
                "utilization_percent": utilization_percent,
            },
        }
    )


def test_process_ownership_is_explicit_in_source():
    main = Path("app/main.py").read_text(encoding="utf-8")
    worker = Path("app/worker_main.py").read_text(encoding="utf-8")

    for forbidden in (
        "outbox_worker_loop",
        "automation_reminders_loop",
        "push_receipt_worker_loop",
    ):
        assert forbidden not in main
        assert forbidden in worker
    assert "redis_subscriber_loop" in main
    assert "redis_subscriber_loop" not in worker
    assert "ApiHeartbeatPublisher" in main
    assert "api_heartbeat_loop" in main
    assert "ApiHeartbeatPublisher" not in worker
    assert "api_heartbeat_loop" not in worker


def test_image_commands_are_explicit_and_role_aware():
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    api_command = Path("docker/renova-api").read_text(encoding="utf-8")
    worker_command = Path("docker/renova-worker").read_text(encoding="utf-8")

    assert 'CMD ["renova-api"]' in dockerfile
    assert 'CMD ["python", "-m", "app.runtime_healthcheck"]' in dockerfile
    assert "uvicorn app.main:app" in api_command
    assert "python -m app.worker_main" in worker_command
    assert "renova-worker" in worker_command


def test_runtime_healthcheck_fails_closed_without_known_role(tmp_path, monkeypatch):
    role_file = tmp_path / "role"
    monkeypatch.setenv("RENOVA_RUNTIME_ROLE_FILE", str(role_file))
    assert runtime_topology.runtime_role() == "unknown"
    assert runtime_healthcheck.main() == 1


def test_worker_healthcheck_requires_fresh_heartbeat(tmp_path, monkeypatch):
    role_file = tmp_path / "role"
    heartbeat_file = tmp_path / "worker.json"
    role_file.write_text("worker\n", encoding="utf-8")
    heartbeat_file.write_text(
        json.dumps(
            {
                "role": "worker",
                "status": "healthy",
                "instance_id": "instance-a",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("RENOVA_RUNTIME_ROLE_FILE", str(role_file))
    monkeypatch.setenv("RENOVA_WORKER_HEARTBEAT_FILE", str(heartbeat_file))

    modified = heartbeat_file.stat().st_mtime
    assert runtime_healthcheck.worker_ready(now=modified + 1)
    assert not runtime_healthcheck.worker_ready(
        now=modified + runtime_topology.WORKER_LOCAL_HEALTH_MAX_AGE_SEC + 1
    )


def test_api_instance_identity_is_anonymous_and_bounded(monkeypatch):
    monkeypatch.delenv("RENOVA_API_INSTANCE_ID", raising=False)
    monkeypatch.setattr(runtime_topology.socket, "gethostname", lambda: "private-api-host.example")
    monkeypatch.setattr(runtime_topology.os, "getpid", lambda: 4321)
    value = runtime_topology.api_instance_id()
    assert len(value) == 20
    assert "private-api-host" not in value
    int(value, 16)


@pytest.mark.asyncio
async def test_worker_publisher_updates_shared_and_local_heartbeat(tmp_path, monkeypatch):
    heartbeat_file = tmp_path / "worker.json"
    monkeypatch.setenv("RENOVA_WORKER_HEARTBEAT_FILE", str(heartbeat_file))
    monkeypatch.setenv("RENOVA_WORKER_INSTANCE_ID", "test-worker-a")
    monkeypatch.setattr(settings, "environment", "test")
    monkeypatch.setattr(settings, "redis_url", None)
    redis = FakeRedis()
    publisher = runtime_topology.WorkerHeartbeatPublisher(redis_client=redis)

    payload = await publisher.publish(
        active_tasks=("domain_outbox",),
        started_at="2026-08-21T10:00:00Z",
    )

    assert payload["role"] == "worker"
    assert payload["active_tasks"] == ["domain_outbox"]
    assert heartbeat_file.exists()
    assert any(key.startswith(runtime_topology.WORKER_REDIS_PREFIX) for key in redis.values)

    await publisher.remove()
    assert not heartbeat_file.exists()
    assert redis.values == {}


@pytest.mark.asyncio
async def test_api_publisher_updates_shared_pool_heartbeat(monkeypatch):
    monkeypatch.setenv("RENOVA_API_INSTANCE_ID", "test-api-a")
    monkeypatch.setattr(settings, "environment", "test")
    monkeypatch.setattr(settings, "redis_url", None)
    monkeypatch.setattr(
        capacity_runtime_service,
        "database_pool_snapshot",
        lambda: {
            "scope": "api_process",
            "instance_id": runtime_topology.api_instance_id(),
            "supported": True,
            "configured_connection_capacity": 15,
            "utilization_percent": 40.0,
        },
    )
    redis = FakeRedis()
    publisher = runtime_topology.ApiHeartbeatPublisher(redis_client=redis)

    payload = await publisher.publish()

    assert payload["role"] == "api"
    assert payload["database_pool"]["utilization_percent"] == 40.0
    assert payload["database_pool"]["instance_id"] == publisher.instance_id
    keys = [key for key in redis.values if key.startswith(runtime_topology.API_REDIS_PREFIX)]
    assert len(keys) == 1

    await publisher.remove()
    assert redis.values == {}


@pytest.mark.asyncio
async def test_worker_pool_requires_current_release_and_artifact(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "redis_url", "redis://redacted.invalid/0")
    monkeypatch.setenv("RENOVA_GIT_SHA", "release-current")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:current")
    redis = FakeRedis(
        {
            f"{runtime_topology.WORKER_REDIS_PREFIX}a": _worker_payload(
                instance_id="worker-a",
                release="release-old",
                artifact_digest="sha256:current",
            )
        }
    )

    release_mismatch = await runtime_topology.worker_pool_snapshot(redis)
    assert release_mismatch["healthy"] is False
    assert release_mismatch["status"] == "release_mismatch"
    assert release_mismatch["live_instances"] == 1
    assert release_mismatch["matching_sha_instances"] == 0
    assert release_mismatch["matching_release_instances"] == 0

    redis.values[f"{runtime_topology.WORKER_REDIS_PREFIX}b"] = _worker_payload(
        instance_id="worker-b",
        release="release-current",
        artifact_digest="sha256:wrong",
    )
    artifact_mismatch = await runtime_topology.worker_pool_snapshot(redis)
    assert artifact_mismatch["healthy"] is False
    assert artifact_mismatch["status"] == "artifact_mismatch"
    assert artifact_mismatch["matching_sha_instances"] == 1
    assert artifact_mismatch["matching_release_instances"] == 0

    redis.values[f"{runtime_topology.WORKER_REDIS_PREFIX}c"] = _worker_payload(
        instance_id="worker-c",
        release="release-current",
        artifact_digest="sha256:current",
    )
    healthy = await runtime_topology.worker_pool_snapshot(redis)
    assert healthy["healthy"] is True
    assert healthy["status"] == "healthy"
    assert healthy["live_instances"] == 3
    assert healthy["matching_sha_instances"] == 2
    assert healthy["matching_release_instances"] == 1
    assert "redis://" not in json.dumps(healthy)


@pytest.mark.asyncio
async def test_api_pool_reports_all_replicas_and_exact_artifact_counts(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "redis_url", "redis://redacted.invalid/0")
    monkeypatch.setenv("RENOVA_GIT_SHA", "release-current")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:current")
    redis = FakeRedis(
        {
            f"{runtime_topology.API_REDIS_PREFIX}a": _api_payload(
                instance_id="api-a",
                release="release-current",
                artifact_digest="sha256:current",
                utilization_percent=30.0,
            ),
            f"{runtime_topology.API_REDIS_PREFIX}b": _api_payload(
                instance_id="api-b",
                release="release-current",
                artifact_digest="sha256:current",
                utilization_percent=70.0,
            ),
            f"{runtime_topology.API_REDIS_PREFIX}old": _api_payload(
                instance_id="api-old",
                release="release-old",
                artifact_digest="sha256:old",
                utilization_percent=10.0,
            ),
        }
    )

    snapshot = await runtime_topology.api_pool_snapshot(redis)

    assert snapshot["healthy"] is True
    assert snapshot["status"] == "healthy"
    assert snapshot["live_instances"] == 3
    assert snapshot["matching_sha_instances"] == 2
    assert snapshot["matching_release_instances"] == 2
    assert [item["instance_id"] for item in snapshot["apis"]] == [
        "api-a",
        "api-b",
        "api-old",
    ]
    assert snapshot["apis"][1]["database_pool"]["utilization_percent"] == 70.0
    assert "redis://" not in json.dumps(snapshot)


@pytest.mark.asyncio
async def test_worker_main_treats_unexpected_loop_exit_as_process_failure(monkeypatch):
    from app import worker_main
    from app.services import outbox_worker

    monkeypatch.setattr(worker_main, "_validate_worker_runtime", AsyncMock())
    monkeypatch.setattr(worker_main, "_install_signal_handlers", Mock())
    monkeypatch.setattr(settings, "automation_reminders_enabled", False)
    monkeypatch.setattr(settings, "push_receipt_worker_enabled", False)

    runtime = Mock()
    runtime.shutdown = Mock()
    monkeypatch.setattr(worker_main, "configure_worker_observability", Mock(return_value=runtime))

    class FakePublisher:
        async def publish(self, **_kwargs):
            return {}

        async def remove(self):
            return None

        async def close(self):
            return None

    monkeypatch.setattr(worker_main, "WorkerHeartbeatPublisher", FakePublisher)

    async def exits_immediately(_stop, *, interval_sec):
        del interval_sec
        return None

    async def heartbeat_until_stopped(stop, _publisher, **_kwargs):
        await stop.wait()

    monkeypatch.setattr(outbox_worker, "outbox_worker_loop", exits_immediately)
    monkeypatch.setattr(worker_main, "worker_heartbeat_loop", heartbeat_until_stopped)
    monkeypatch.setattr(worker_main.rate_limiter, "close", AsyncMock())

    assert await worker_main.run_worker() == 1
    runtime.shutdown.assert_called_once()


@pytest.mark.asyncio
async def test_worker_startup_failure_after_first_heartbeat_always_cleans_up(monkeypatch):
    from app import worker_main

    monkeypatch.setattr(worker_main, "_validate_worker_runtime", AsyncMock())
    monkeypatch.setattr(worker_main, "_install_signal_handlers", Mock())

    runtime = Mock()
    runtime.shutdown = Mock()
    monkeypatch.setattr(worker_main, "configure_worker_observability", Mock(return_value=runtime))

    publisher = Mock()
    publisher.publish = AsyncMock(return_value={})
    publisher.remove = AsyncMock()
    publisher.close = AsyncMock()
    monkeypatch.setattr(worker_main, "WorkerHeartbeatPublisher", Mock(return_value=publisher))
    monkeypatch.setattr(
        worker_main,
        "_start_worker_tasks",
        AsyncMock(side_effect=RuntimeError("task-bootstrap-failed")),
    )
    monkeypatch.setattr(worker_main.rate_limiter, "close", AsyncMock())

    with pytest.raises(RuntimeError, match="task-bootstrap-failed"):
        await worker_main.run_worker()

    publisher.publish.assert_awaited_once()
    publisher.remove.assert_awaited_once()
    publisher.close.assert_awaited_once()
    worker_main.rate_limiter.close.assert_awaited_once()
    runtime.shutdown.assert_called_once()
