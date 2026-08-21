"""Role-aware healthcheck for the single Renova backend image."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

from app.services.runtime_topology import (
    WORKER_LOCAL_HEALTH_MAX_AGE_SEC,
    runtime_role,
    worker_heartbeat_file,
)


def api_ready() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8100/ready", timeout=2) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return False
    return payload.get("status") == "ready" and payload.get("service") == "renova-api"


def worker_ready(*, now: float | None = None) -> bool:
    path = worker_heartbeat_file()
    try:
        stat = path.stat()
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False
    current = time.time() if now is None else now
    age = max(0.0, current - stat.st_mtime)
    return (
        age <= WORKER_LOCAL_HEALTH_MAX_AGE_SEC
        and isinstance(payload, dict)
        and payload.get("role") == "worker"
        and payload.get("status") == "healthy"
        and bool(payload.get("instance_id"))
    )


def main() -> int:
    role = runtime_role()
    if role == "api":
        return 0 if api_ready() else 1
    if role == "worker":
        return 0 if worker_ready() else 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
