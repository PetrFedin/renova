"""Shared, side-effect-free runtime health classification.

Operational endpoints must not derive different answers from the same metrics.
Keep these classifiers pure so API, release-health and tests share one contract.
"""
from __future__ import annotations

from typing import Any


def automation_worker_runtime_truth(metrics: dict[str, Any]) -> dict[str, object]:
    """Classify both worker execution and its durable outbox dependency."""
    failures = max(0, int(metrics.get("consecutive_failures") or 0))
    tick_healthy = failures < 3
    outbox_status = str(metrics.get("outbox_status") or "unknown").strip().lower()
    if outbox_status not in {"healthy", "degraded", "critical"}:
        outbox_status = "unknown"
    outbox_healthy = outbox_status == "healthy"

    if not tick_healthy or outbox_status == "critical":
        status = "critical"
    elif outbox_status == "degraded":
        status = "degraded"
    elif outbox_status == "healthy":
        status = "healthy"
    else:
        status = "unknown"

    return {
        "healthy": status == "healthy",
        "status": status,
        "tick_healthy": tick_healthy,
        "outbox_healthy": outbox_healthy,
    }
