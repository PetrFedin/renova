#!/usr/bin/env python3
"""Evaluate sanitized runtime samples from a protected external staging load run."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

DB_POOL_MAX_PERCENT = 90.0
DB_PROBE_P95_MAX_MS = 250.0
REDIS_PROBE_P95_MAX_MS = 100.0
OUTBOX_OLDEST_MAX_SECONDS = 300
MIN_SAMPLES = 2


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        fail(f"{name} is required")
    return value


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile_value * len(ordered)) - 1)
    return round(float(ordered[index]), 2)


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int:
    number = as_number(value)
    return int(number) if number is not None else 0


def main() -> None:
    out_dir = Path(os.environ.get("OUT_DIR") or "/tmp/renova-load-slo")
    samples_path = out_dir / "capacity-samples.ndjson"
    evidence_path = out_dir / "capacity-evidence.json"
    expected_sha = required("EXPECTED_RELEASE_SHA")
    expected_digest = required("EXPECTED_IMAGE_DIGEST")
    min_api_instances = int((os.environ.get("CAPACITY_MIN_API_INSTANCES") or "2").strip())
    if min_api_instances < 1 or min_api_instances > 32:
        fail("CAPACITY_MIN_API_INSTANCES must be between 1 and 32")
    if not samples_path.exists():
        fail("capacity samples are missing")

    samples: list[dict[str, Any]] = []
    for raw in samples_path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            fail("capacity sample must be an object")
        samples.append(payload)

    reasons: list[str] = []
    if len(samples) < MIN_SAMPLES:
        reasons.append(f"insufficient_samples:{len(samples)}<{MIN_SAMPLES}")

    db_latencies: list[float] = []
    redis_latencies: list[float] = []
    pool_by_instance: dict[str, list[float]] = {}
    outbox_pending: list[int] = []
    outbox_ages: list[int] = []
    push_due: list[int] = []
    push_pending: list[int] = []
    min_matching_workers: int | None = None
    min_matching_apis: int | None = None
    min_live_apis: int | None = None

    for index, sample in enumerate(samples):
        if sample.get("ok") is not True:
            reasons.append(f"sample_{index}:telemetry_unavailable")
            continue
        if sample.get("release_sha") != expected_sha:
            reasons.append(f"sample_{index}:release_sha_mismatch")
        if sample.get("image_digest") != expected_digest:
            reasons.append(f"sample_{index}:image_digest_mismatch")

        database = sample.get("database") or {}
        probe = database.get("probe") or {}
        if probe.get("available") is not True:
            reasons.append(f"sample_{index}:database_unavailable")
        latency = as_number(probe.get("probe_latency_ms"))
        if latency is None:
            reasons.append(f"sample_{index}:database_latency_missing")
        else:
            db_latencies.append(latency)

        api_pool = sample.get("api_pool") or {}
        if api_pool.get("healthy") is not True or api_pool.get("status") != "healthy":
            reasons.append(f"sample_{index}:api_pool_unhealthy")
        live_apis = as_int(api_pool.get("live_instances"))
        matching_apis = as_int(api_pool.get("matching_release_instances"))
        min_live_apis = live_apis if min_live_apis is None else min(min_live_apis, live_apis)
        min_matching_apis = (
            matching_apis
            if min_matching_apis is None
            else min(min_matching_apis, matching_apis)
        )
        if matching_apis < min_api_instances:
            reasons.append(
                f"sample_{index}:matching_api_instances:{matching_apis}<{min_api_instances}"
            )
        if live_apis != matching_apis:
            reasons.append(f"sample_{index}:api_artifact_mixed")

        raw_apis = api_pool.get("apis")
        apis = raw_apis if isinstance(raw_apis, list) else []
        exact_entries = 0
        for api in apis:
            if not isinstance(api, dict):
                continue
            if api.get("release") != expected_sha or api.get("artifact_digest") != expected_digest:
                continue
            exact_entries += 1
            instance_id = str(api.get("instance_id") or "").strip()
            pool = api.get("database_pool") or {}
            if not instance_id:
                reasons.append(f"sample_{index}:api_instance_missing")
                continue
            if pool.get("supported") is not True:
                reasons.append(f"sample_{index}:{instance_id}:database_pool_unsupported")
                continue
            utilization = as_number(pool.get("utilization_percent"))
            if utilization is None:
                reasons.append(f"sample_{index}:{instance_id}:pool_utilization_missing")
                continue
            pool_by_instance.setdefault(instance_id, []).append(utilization)
        if exact_entries < min_api_instances:
            reasons.append(
                f"sample_{index}:api_registry_entries:{exact_entries}<{min_api_instances}"
            )
        if matching_apis != exact_entries:
            reasons.append(f"sample_{index}:api_registry_count_mismatch")

        redis = sample.get("redis") or {}
        if redis.get("configured") is not True or redis.get("available") is not True:
            reasons.append(f"sample_{index}:redis_unavailable")
        redis_latency = as_number(redis.get("probe_latency_ms"))
        if redis_latency is None:
            reasons.append(f"sample_{index}:redis_latency_missing")
        else:
            redis_latencies.append(redis_latency)

        workers = sample.get("worker_pool") or {}
        if workers.get("healthy") is not True or workers.get("status") != "healthy":
            reasons.append(f"sample_{index}:worker_pool_unhealthy")
        live_workers = as_int(workers.get("live_instances"))
        matching_workers = as_int(workers.get("matching_release_instances"))
        if matching_workers < 1:
            reasons.append(f"sample_{index}:matching_worker_missing")
        if live_workers != matching_workers:
            reasons.append(f"sample_{index}:worker_artifact_mixed")
        min_matching_workers = (
            matching_workers
            if min_matching_workers is None
            else min(min_matching_workers, matching_workers)
        )

        outbox = sample.get("outbox") or {}
        if as_int(outbox.get("poisoned")) != 0:
            reasons.append(f"sample_{index}:outbox_poisoned")
        if as_int(outbox.get("stale_leases")) != 0:
            reasons.append(f"sample_{index}:outbox_stale_lease")
        outbox_pending.append(as_int(outbox.get("pending")))
        oldest_age = outbox.get("oldest_pending_age_seconds")
        if oldest_age is not None:
            age = as_int(oldest_age)
            outbox_ages.append(age)
            if age > OUTBOX_OLDEST_MAX_SECONDS:
                reasons.append(f"sample_{index}:outbox_age>{OUTBOX_OLDEST_MAX_SECONDS}")

        push = sample.get("push_receipts") or {}
        if as_int(push.get("stale_leases")) != 0:
            reasons.append(f"sample_{index}:push_receipt_stale_lease")
        push_due.append(as_int(push.get("due")))
        push_pending.append(as_int(push.get("pending")))

    observed_api_instances = sorted(pool_by_instance)
    if len(observed_api_instances) < min_api_instances:
        reasons.append(
            f"api_instances_observed:{len(observed_api_instances)}<{min_api_instances}"
        )

    pool_max_by_instance = {
        instance: round(max(values), 2)
        for instance, values in sorted(pool_by_instance.items())
        if values
    }
    max_pool = max(pool_max_by_instance.values(), default=None)
    if max_pool is None:
        reasons.append("pool_utilization_not_measured")
    elif max_pool >= DB_POOL_MAX_PERCENT:
        reasons.append(f"database_pool_utilization>={DB_POOL_MAX_PERCENT}")

    db_p95 = percentile(db_latencies, 0.95)
    if db_p95 is None:
        reasons.append("database_probe_p95_not_measured")
    elif db_p95 >= DB_PROBE_P95_MAX_MS:
        reasons.append(f"database_probe_p95>={DB_PROBE_P95_MAX_MS}")

    redis_p95 = percentile(redis_latencies, 0.95)
    if redis_p95 is None:
        reasons.append("redis_probe_p95_not_measured")
    elif redis_p95 >= REDIS_PROBE_P95_MAX_MS:
        reasons.append(f"redis_probe_p95>={REDIS_PROBE_P95_MAX_MS}")

    unique_reasons = sorted(set(reasons))
    evidence = {
        "verified": not unique_reasons,
        "release_sha": expected_sha,
        "image_digest": expected_digest,
        "sample_count": len(samples),
        "candidate_limits": {
            "database_pool_max_percent": DB_POOL_MAX_PERCENT,
            "database_probe_p95_max_ms": DB_PROBE_P95_MAX_MS,
            "redis_probe_p95_max_ms": REDIS_PROBE_P95_MAX_MS,
            "outbox_oldest_pending_max_seconds": OUTBOX_OLDEST_MAX_SECONDS,
            "min_exact_api_instances": min_api_instances,
            "min_exact_worker_instances": 1,
            "mixed_release_instances_allowed": False,
        },
        "observed": {
            "api_instances": observed_api_instances,
            "min_live_api_instances": min_live_apis,
            "min_matching_api_instances": min_matching_apis,
            "database_pool_max_percent_by_instance": pool_max_by_instance,
            "database_pool_max_percent": max_pool,
            "database_probe_p95_ms": db_p95,
            "redis_probe_p95_ms": redis_p95,
            "min_matching_worker_instances": min_matching_workers,
            "max_outbox_pending": max(outbox_pending, default=0),
            "max_outbox_oldest_pending_age_seconds": max(outbox_ages, default=0),
            "max_push_receipts_pending": max(push_pending, default=0),
            "max_push_receipts_due": max(push_due, default=0),
        },
        "notes": {
            "database_pool_scope": "shared_api_heartbeat_registry",
            "load_balancer_routing_dependency": "none_for_replica_count_or_pool_pressure",
            "redis_utilization_percent": "not_claimed",
            "provider_cpu_memory": "not_claimed",
            "push_pending_age": "recorded_but_not_thresholded_because_receipts_have_provider_delay",
        },
        "failures": unique_reasons,
    }
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, sort_keys=True))
    if unique_reasons:
        fail("capacity evidence failed: " + ", ".join(unique_reasons))


if __name__ == "__main__":
    main()
