"""Cross-process runtime topology and shared heartbeat truth.

Durable jobs belong to the explicit worker process. API replicas still publish a
small operational heartbeat so release/capacity evidence can prove the actual
multi-replica topology without depending on load-balancer routing behavior.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from redis.asyncio import Redis

from app.core.config import settings
from app.core.observability import release_digest, release_sha

RUNTIME_ROLE_FILE = "/tmp/renova-runtime-role"
WORKER_HEARTBEAT_FILE = "/tmp/renova-worker-heartbeat.json"
WORKER_REDIS_PREFIX = "renova:runtime:worker:"
API_REDIS_PREFIX = "renova:runtime:api:"
WORKER_HEARTBEAT_INTERVAL_SEC = 5.0
WORKER_HEARTBEAT_TTL_SEC = 20
WORKER_LOCAL_HEALTH_MAX_AGE_SEC = 15.0
API_HEARTBEAT_INTERVAL_SEC = 5.0
API_HEARTBEAT_TTL_SEC = 20


def _path(env_name: str, default: str) -> Path:
    return Path((os.getenv(env_name) or default).strip() or default)


def runtime_role_file() -> Path:
    return _path("RENOVA_RUNTIME_ROLE_FILE", RUNTIME_ROLE_FILE)


def worker_heartbeat_file() -> Path:
    return _path("RENOVA_WORKER_HEARTBEAT_FILE", WORKER_HEARTBEAT_FILE)


def runtime_role() -> str:
    try:
        value = runtime_role_file().read_text(encoding="utf-8").strip().lower()
    except OSError:
        return "unknown"
    return value if value in {"api", "worker"} else "unknown"


def _instance_id(explicit_env: str) -> str:
    explicit = (os.getenv(explicit_env) or "").strip()
    identity = explicit or f"{socket.gethostname()}:{os.getpid()}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]


def worker_instance_id() -> str:
    return _instance_id("RENOVA_WORKER_INSTANCE_ID")


def api_instance_id() -> str:
    return _instance_id("RENOVA_API_INSTANCE_ID")


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def local_worker_heartbeat_snapshot() -> dict[str, Any] | None:
    path = worker_heartbeat_file()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        modified_at = path.stat().st_mtime
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    snapshot = dict(payload)
    snapshot["file_age_seconds"] = max(0.0, time.time() - modified_at)
    return snapshot


class WorkerHeartbeatPublisher:
    def __init__(self, redis_client: Redis | None = None) -> None:
        self.instance_id = worker_instance_id()
        self._redis = redis_client
        self._owns_redis = False
        self._redis_key = f"{WORKER_REDIS_PREFIX}{self.instance_id}"

    def _client(self) -> Redis | None:
        if self._redis is not None:
            return self._redis
        redis_url = (settings.redis_url or "").strip()
        if not redis_url:
            return None
        self._redis = Redis.from_url(redis_url, decode_responses=True)
        self._owns_redis = True
        return self._redis

    def payload(self, *, active_tasks: tuple[str, ...], started_at: str) -> dict[str, Any]:
        return {
            "contract_version": 1,
            "role": "worker",
            "status": "healthy",
            "instance_id": self.instance_id,
            "pid": os.getpid(),
            "release": release_sha(),
            "artifact_digest": release_digest(),
            "started_at": started_at,
            "heartbeat_at": _utc_iso(),
            "active_tasks": list(active_tasks),
        }

    async def publish(self, *, active_tasks: tuple[str, ...], started_at: str) -> dict[str, Any]:
        payload = self.payload(active_tasks=active_tasks, started_at=started_at)
        client = self._client()
        deployed = settings.normalized_environment in {"staging", "production"}
        if client is None:
            if deployed:
                raise RuntimeError("worker heartbeat Redis is required in deployed environments")
        else:
            await client.set(
                self._redis_key,
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
                ex=WORKER_HEARTBEAT_TTL_SEC,
            )

        # In deployed environments the local heartbeat is only refreshed after
        # Redis accepted the shared heartbeat. A broken shared control plane thus
        # makes the worker container unhealthy instead of falsely green.
        _atomic_write_json(worker_heartbeat_file(), payload)
        return payload

    async def remove(self) -> None:
        client = self._client()
        if client is not None:
            try:
                await client.delete(self._redis_key)
            except Exception:
                pass
        try:
            worker_heartbeat_file().unlink()
        except FileNotFoundError:
            pass

    async def close(self) -> None:
        if self._redis is not None and self._owns_redis:
            await self._redis.aclose()
        self._redis = None
        self._owns_redis = False


class ApiHeartbeatPublisher:
    """Publish API replica identity and its own SQLAlchemy pool pressure."""

    def __init__(self, redis_client: Redis | None = None) -> None:
        self.instance_id = api_instance_id()
        self.started_at = _utc_iso()
        self._redis = redis_client
        self._owns_redis = False
        self._redis_key = f"{API_REDIS_PREFIX}{self.instance_id}"

    def _client(self) -> Redis | None:
        if self._redis is not None:
            return self._redis
        redis_url = (settings.redis_url or "").strip()
        if not redis_url:
            return None
        self._redis = Redis.from_url(redis_url, decode_responses=True)
        self._owns_redis = True
        return self._redis

    def payload(self) -> dict[str, Any]:
        from app.services.capacity_runtime_service import database_pool_snapshot

        return {
            "contract_version": 1,
            "role": "api",
            "status": "healthy",
            "instance_id": self.instance_id,
            "release": release_sha(),
            "artifact_digest": release_digest(),
            "started_at": self.started_at,
            "heartbeat_at": _utc_iso(),
            "database_pool": database_pool_snapshot(),
        }

    async def publish(self) -> dict[str, Any]:
        payload = self.payload()
        client = self._client()
        deployed = settings.normalized_environment in {"staging", "production"}
        if client is None:
            if deployed:
                raise RuntimeError("API heartbeat Redis is required in deployed environments")
            return payload
        await client.set(
            self._redis_key,
            json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ex=API_HEARTBEAT_TTL_SEC,
        )
        return payload

    async def remove(self) -> None:
        client = self._client()
        if client is not None:
            try:
                await client.delete(self._redis_key)
            except Exception:
                pass

    async def close(self) -> None:
        if self._redis is not None and self._owns_redis:
            await self._redis.aclose()
        self._redis = None
        self._owns_redis = False


async def worker_heartbeat_loop(
    stop: asyncio.Event,
    publisher: WorkerHeartbeatPublisher,
    *,
    active_tasks: tuple[str, ...],
    started_at: str,
) -> None:
    while not stop.is_set():
        try:
            await publisher.publish(active_tasks=active_tasks, started_at=started_at)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Do not refresh the local heartbeat on failure. Docker/Kubernetes
            # health then transitions to unhealthy while the Redis key expires.
            import logging

            logging.getLogger("renova.runtime.worker_heartbeat").exception(
                "worker heartbeat publish failed"
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=WORKER_HEARTBEAT_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass


async def api_heartbeat_loop(stop: asyncio.Event, publisher: ApiHeartbeatPublisher) -> None:
    while not stop.is_set():
        try:
            await publisher.publish()
        except asyncio.CancelledError:
            raise
        except Exception:
            import logging

            logging.getLogger("renova.runtime.api_heartbeat").exception(
                "API heartbeat publish failed"
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=API_HEARTBEAT_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass


def _bounded_worker(payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("role") != "worker" or payload.get("status") != "healthy":
        return None
    instance_id = str(payload.get("instance_id") or "")[:32]
    if not instance_id:
        return None
    tasks = payload.get("active_tasks")
    if not isinstance(tasks, list):
        tasks = []
    return {
        "instance_id": instance_id,
        "release": str(payload.get("release") or "unknown")[:64],
        "artifact_digest": str(payload.get("artifact_digest") or "unknown")[:128],
        "started_at": str(payload.get("started_at") or "")[:64] or None,
        "heartbeat_at": str(payload.get("heartbeat_at") or "")[:64] or None,
        "active_tasks": sorted(str(item)[:64] for item in tasks[:16]),
    }


def _bounded_api(payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("role") != "api" or payload.get("status") != "healthy":
        return None
    instance_id = str(payload.get("instance_id") or "")[:32]
    if not instance_id:
        return None
    raw_pool = payload.get("database_pool")
    pool = raw_pool if isinstance(raw_pool, dict) else {}
    return {
        "instance_id": instance_id,
        "release": str(payload.get("release") or "unknown")[:64],
        "artifact_digest": str(payload.get("artifact_digest") or "unknown")[:128],
        "started_at": str(payload.get("started_at") or "")[:64] or None,
        "heartbeat_at": str(payload.get("heartbeat_at") or "")[:64] or None,
        "database_pool": {
            "scope": "api_process",
            "instance_id": instance_id,
            "supported": bool(pool.get("supported")),
            "configured_pool_size": pool.get("configured_pool_size"),
            "configured_max_overflow": pool.get("configured_max_overflow"),
            "configured_connection_capacity": pool.get("configured_connection_capacity"),
            "pool_timeout_seconds": pool.get("pool_timeout_seconds"),
            "checked_out": pool.get("checked_out"),
            "checked_in": pool.get("checked_in"),
            "current_overflow": pool.get("current_overflow"),
            "utilization_percent": pool.get("utilization_percent"),
        },
    }


async def worker_pool_snapshot(redis_client: Redis | None = None) -> dict[str, Any]:
    """Return bounded shared worker health without exposing Redis credentials."""
    redis_url = (settings.redis_url or "").strip()
    deployed = settings.normalized_environment in {"staging", "production"}
    configured = redis_client is not None or bool(redis_url)
    current_release = release_sha()
    current_digest = release_digest()
    base: dict[str, Any] = {
        "required": True,
        "configured": configured,
        "runtime_owner": "renova-worker",
        "current_release": current_release,
        "current_artifact_digest": current_digest,
        "live_instances": 0,
        "matching_sha_instances": 0,
        "matching_release_instances": 0,
        "workers": [],
    }
    if not configured:
        return {
            **base,
            "healthy": False,
            "status": "not_configured" if deployed else "unavailable",
        }

    client = redis_client
    owns_client = False
    if client is None:
        client = Redis.from_url(redis_url, decode_responses=True)
        owns_client = True
    try:
        keys = [
            key
            async for key in client.scan_iter(
                match=f"{WORKER_REDIS_PREFIX}*",
                count=100,
            )
        ]
        values = await client.mget(keys) if keys else []
    except Exception:
        return {**base, "healthy": False, "status": "unavailable"}
    finally:
        if owns_client and client is not None:
            await client.aclose()

    workers: list[dict[str, Any]] = []
    for raw in values:
        try:
            parsed = json.loads(raw) if raw else None
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(parsed, dict):
            continue
        bounded = _bounded_worker(parsed)
        if bounded is not None:
            workers.append(bounded)
    workers.sort(key=lambda item: item["instance_id"])

    live = len(workers)
    sha_matching = (
        live
        if current_release == "unknown"
        else sum(1 for item in workers if item["release"] == current_release)
    )

    def matches_current_artifact(item: dict[str, Any]) -> bool:
        sha_ok = current_release == "unknown" or item["release"] == current_release
        digest_ok = current_digest == "unknown" or item["artifact_digest"] == current_digest
        return sha_ok and digest_ok

    matching = sum(1 for item in workers if matches_current_artifact(item))
    if live == 0:
        status = "missing"
        healthy = False
    elif sha_matching == 0:
        status = "release_mismatch"
        healthy = False
    elif matching == 0:
        status = "artifact_mismatch"
        healthy = False
    else:
        status = "healthy"
        healthy = True
    return {
        **base,
        "healthy": healthy,
        "status": status,
        "live_instances": live,
        "matching_sha_instances": sha_matching,
        "matching_release_instances": matching,
        "workers": workers[:32],
    }


async def api_pool_snapshot(redis_client: Redis | None = None) -> dict[str, Any]:
    """Return shared API replica/release/pool truth from Redis heartbeats."""
    redis_url = (settings.redis_url or "").strip()
    deployed = settings.normalized_environment in {"staging", "production"}
    configured = redis_client is not None or bool(redis_url)
    current_release = release_sha()
    current_digest = release_digest()
    base: dict[str, Any] = {
        "required": True,
        "configured": configured,
        "runtime_owner": "renova-api",
        "current_release": current_release,
        "current_artifact_digest": current_digest,
        "live_instances": 0,
        "matching_sha_instances": 0,
        "matching_release_instances": 0,
        "apis": [],
    }
    if not configured:
        return {
            **base,
            "healthy": False,
            "status": "not_configured" if deployed else "unavailable",
        }

    client = redis_client
    owns_client = False
    if client is None:
        client = Redis.from_url(redis_url, decode_responses=True)
        owns_client = True
    try:
        keys = [
            key
            async for key in client.scan_iter(match=f"{API_REDIS_PREFIX}*", count=100)
        ]
        values = await client.mget(keys) if keys else []
    except Exception:
        return {**base, "healthy": False, "status": "unavailable"}
    finally:
        if owns_client and client is not None:
            await client.aclose()

    apis: list[dict[str, Any]] = []
    for raw in values:
        try:
            parsed = json.loads(raw) if raw else None
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(parsed, dict):
            continue
        bounded = _bounded_api(parsed)
        if bounded is not None:
            apis.append(bounded)
    apis.sort(key=lambda item: item["instance_id"])

    live = len(apis)
    sha_matching = (
        live
        if current_release == "unknown"
        else sum(1 for item in apis if item["release"] == current_release)
    )

    def matches_current_artifact(item: dict[str, Any]) -> bool:
        sha_ok = current_release == "unknown" or item["release"] == current_release
        digest_ok = current_digest == "unknown" or item["artifact_digest"] == current_digest
        return sha_ok and digest_ok

    matching = sum(1 for item in apis if matches_current_artifact(item))
    if live == 0:
        status = "missing"
        healthy = False
    elif sha_matching == 0:
        status = "release_mismatch"
        healthy = False
    elif matching == 0:
        status = "artifact_mismatch"
        healthy = False
    else:
        status = "healthy"
        healthy = True
    return {
        **base,
        "healthy": healthy,
        "status": status,
        "live_instances": live,
        "matching_sha_instances": sha_matching,
        "matching_release_instances": matching,
        "apis": apis[:32],
    }
