from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from app import runtime_healthcheck
from app.core.config import settings
from app.services import runtime_topology


class FakeRedis:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values = dict(values or {})
        self.closed = False

    async def set(self, key, value, *, ex=None):
        assert ex == runtime_topology.WORKER_HEARTBEAT_TTL_SEC
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
