#!/usr/bin/env python3
"""Sample sanitized Renova capacity signals while an external load run is active."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        fail(f"{name} is required")
    return value


def bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        fail(f"{name} must be numeric")
    if value < minimum or value > maximum:
        fail(f"{name} must be between {minimum} and {maximum}")
    return value


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_json(url: str, token: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "renova-capacity-sampler/2",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:  # nosec B310: HTTPS required below
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("release-health payload must be an object")
    return payload


def _bounded_api_pool(raw: Any) -> dict[str, Any]:
    pool = raw if isinstance(raw, dict) else {}
    apis = pool.get("apis")
    if not isinstance(apis, list):
        apis = []
    bounded_apis: list[dict[str, Any]] = []
    for item in apis[:32]:
        if not isinstance(item, dict):
            continue
        db_pool = item.get("database_pool")
        if not isinstance(db_pool, dict):
            db_pool = {}
        bounded_apis.append(
            {
                "instance_id": item.get("instance_id"),
                "release": item.get("release"),
                "artifact_digest": item.get("artifact_digest"),
                "heartbeat_at": item.get("heartbeat_at"),
                "database_pool": {
                    "scope": db_pool.get("scope"),
                    "instance_id": db_pool.get("instance_id"),
                    "supported": db_pool.get("supported"),
                    "configured_pool_size": db_pool.get("configured_pool_size"),
                    "configured_max_overflow": db_pool.get("configured_max_overflow"),
                    "configured_connection_capacity": db_pool.get(
                        "configured_connection_capacity"
                    ),
                    "pool_timeout_seconds": db_pool.get("pool_timeout_seconds"),
                    "checked_out": db_pool.get("checked_out"),
                    "checked_in": db_pool.get("checked_in"),
                    "current_overflow": db_pool.get("current_overflow"),
                    "utilization_percent": db_pool.get("utilization_percent"),
                },
            }
        )
    return {
        "healthy": pool.get("healthy"),
        "status": pool.get("status"),
        "live_instances": pool.get("live_instances"),
        "matching_sha_instances": pool.get("matching_sha_instances"),
        "matching_release_instances": pool.get("matching_release_instances"),
        "apis": bounded_apis,
    }


def sanitize(payload: dict[str, Any]) -> dict[str, Any]:
    release = payload.get("release") or {}
    observability = payload.get("observability") or {}
    artifact = observability.get("artifact") or {}
    capacity = payload.get("capacity") or {}
    database = capacity.get("database") or {}
    redis = capacity.get("redis") or {}
    worker_pool = capacity.get("worker_pool") or {}
    integrations = payload.get("integrations") or {}
    outbox = integrations.get("outbox") or {}
    push_receipts = integrations.get("push_receipts") or {}

    return {
        "sampled_at": utc_iso(),
        "ok": True,
        "release_sha": release.get("commit_sha"),
        "image_digest": artifact.get("image_digest"),
        "database": {
            "probe": database.get("probe"),
            "local_pool": database.get("local_pool"),
        },
        "api_pool": _bounded_api_pool(capacity.get("api_pool")),
        "redis": redis,
        "worker_pool": {
            "healthy": worker_pool.get("healthy"),
            "status": worker_pool.get("status"),
            "live_instances": worker_pool.get("live_instances"),
            "matching_sha_instances": worker_pool.get("matching_sha_instances"),
            "matching_release_instances": worker_pool.get("matching_release_instances"),
        },
        "outbox": {
            "pending": outbox.get("pending"),
            "retryable": outbox.get("retryable"),
            "poisoned": outbox.get("poisoned"),
            "stale_leases": outbox.get("stale_leases"),
            "oldest_pending_age_seconds": outbox.get("oldest_pending_age_seconds"),
        },
        "push_receipts": {
            "pending": push_receipts.get("pending"),
            "due": push_receipts.get("due"),
            "terminal_errors": push_receipts.get("terminal_errors"),
            "stale_leases": push_receipts.get("stale_leases"),
            "oldest_pending_age_seconds": push_receipts.get("oldest_pending_age_seconds"),
        },
    }


def error_sample(code: str, status: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sampled_at": utc_iso(),
        "ok": False,
        "error_code": code,
    }
    if status is not None:
        payload["http_status"] = status
    return payload


def main() -> None:
    api_base = required("API_BASE").rstrip("/")
    token = required("TOKEN")
    if not api_base.startswith("https://"):
        fail("API_BASE must use https://")

    out_dir = Path(os.environ.get("OUT_DIR") or "/tmp/renova-load-slo")
    out_dir.mkdir(parents=True, exist_ok=True)
    samples_path = out_dir / "capacity-samples.ndjson"
    stop_path = Path(
        os.environ.get("CAPACITY_SAMPLE_STOP_FILE")
        or str(out_dir / "capacity-sampler.stop")
    )
    interval = bounded_float("CAPACITY_SAMPLE_INTERVAL_SEC", 5.0, 1.0, 60.0)
    endpoint = f"{api_base}/api/v1/admin/release-health"

    try:
        stop_path.unlink()
    except FileNotFoundError:
        pass

    with samples_path.open("w", encoding="utf-8") as handle:
        while True:
            try:
                sample = sanitize(get_json(endpoint, token))
            except urllib.error.HTTPError as exc:
                sample = error_sample("http_error", exc.code)
            except urllib.error.URLError:
                sample = error_sample("network_error")
            except (TimeoutError, json.JSONDecodeError, ValueError, TypeError):
                sample = error_sample("invalid_or_unavailable")
            handle.write(json.dumps(sample, sort_keys=True) + "\n")
            handle.flush()
            if stop_path.exists():
                break
            time.sleep(interval)


if __name__ == "__main__":
    main()
