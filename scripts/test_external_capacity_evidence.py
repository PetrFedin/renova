#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_SHA = "a" * 40
EXPECTED_DIGEST = "sha256:" + "b" * 64


def load_script(module_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(module_name, ROOT / "scripts" / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sampler = load_script("renova_capacity_sampler", "external-capacity-sampler.py")
evaluator = load_script("renova_capacity_evaluator", "external-capacity-evaluate.py")


def sample(instance_id: str, *, pool: float = 40.0, db_ms: float = 30.0, redis_ms: float = 10.0):
    return {
        "sampled_at": "2026-08-21T00:00:00+00:00",
        "ok": True,
        "release_sha": EXPECTED_SHA,
        "image_digest": EXPECTED_DIGEST,
        "database": {
            "probe": {"available": True, "probe_latency_ms": db_ms},
            "pool": {
                "scope": "api_process",
                "instance_id": instance_id,
                "supported": True,
                "configured_connection_capacity": 15,
                "utilization_percent": pool,
            },
        },
        "redis": {"configured": True, "available": True, "probe_latency_ms": redis_ms},
        "worker_pool": {
            "healthy": True,
            "status": "healthy",
            "live_instances": 1,
            "matching_release_instances": 1,
        },
        "outbox": {
            "pending": 1,
            "retryable": 0,
            "poisoned": 0,
            "stale_leases": 0,
            "oldest_pending_age_seconds": 20,
        },
        "push_receipts": {
            "pending": 3,
            "due": 0,
            "terminal_errors": 0,
            "stale_leases": 0,
            "oldest_pending_age_seconds": 500,
        },
    }


class CapacityEvidenceTests(unittest.TestCase):
    def run_evaluator(self, samples, *, min_instances="2"):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        out = Path(temp.name)
        (out / "capacity-samples.ndjson").write_text(
            "".join(json.dumps(item) + "\n" for item in samples), encoding="utf-8"
        )
        env = {
            "OUT_DIR": str(out),
            "EXPECTED_RELEASE_SHA": EXPECTED_SHA,
            "EXPECTED_IMAGE_DIGEST": EXPECTED_DIGEST,
            "CAPACITY_MIN_API_INSTANCES": min_instances,
        }
        with patch.dict(os.environ, env, clear=False):
            try:
                evaluator.main()
                exit_code = 0
            except SystemExit:
                exit_code = 1
        evidence = json.loads((out / "capacity-evidence.json").read_text(encoding="utf-8"))
        return exit_code, evidence

    def test_two_api_instances_with_healthy_runtime_pass(self):
        exit_code, evidence = self.run_evaluator(
            [sample("api-a", pool=35), sample("api-b", pool=45), sample("api-a", pool=50)]
        )
        self.assertEqual(exit_code, 0)
        self.assertTrue(evidence["verified"])
        self.assertEqual(evidence["observed"]["api_instances"], ["api-a", "api-b"])
        self.assertEqual(evidence["observed"]["database_pool_max_percent"], 50.0)
        self.assertEqual(evidence["failures"], [])

    def test_one_api_instance_cannot_claim_two_replica_capacity(self):
        exit_code, evidence = self.run_evaluator([sample("api-a"), sample("api-a")])
        self.assertEqual(exit_code, 1)
        self.assertFalse(evidence["verified"])
        self.assertIn("api_instances_observed:1<2", evidence["failures"])

    def test_pool_redis_worker_and_outbox_fail_closed(self):
        bad = sample("api-b", pool=95, db_ms=300, redis_ms=150)
        bad["redis"]["available"] = False
        bad["worker_pool"]["healthy"] = False
        bad["worker_pool"]["status"] = "missing"
        bad["worker_pool"]["matching_release_instances"] = 0
        bad["outbox"]["stale_leases"] = 1
        bad["outbox"]["oldest_pending_age_seconds"] = 301
        exit_code, evidence = self.run_evaluator([sample("api-a"), bad])
        self.assertEqual(exit_code, 1)
        failures = evidence["failures"]
        self.assertIn("database_pool_utilization>=90.0", failures)
        self.assertIn("database_probe_p95>=250.0", failures)
        self.assertIn("redis_probe_p95>=100.0", failures)
        self.assertIn("sample_1:redis_unavailable", failures)
        self.assertIn("sample_1:worker_pool_unhealthy", failures)
        self.assertIn("sample_1:matching_worker_missing", failures)
        self.assertIn("sample_1:outbox_stale_lease", failures)
        self.assertIn("sample_1:outbox_age>300", failures)

    def test_sampler_sanitizes_raw_release_health(self):
        raw = {
            "release": {"commit_sha": EXPECTED_SHA},
            "observability": {
                "artifact": {"image_digest": EXPECTED_DIGEST},
                "private_token": "do-not-copy",
            },
            "capacity": {
                "database": {
                    "probe": {"available": True, "probe_latency_ms": 12},
                    "pool": {"instance_id": "api-a", "utilization_percent": 30},
                },
                "redis": {"configured": True, "available": True, "probe_latency_ms": 5},
                "worker_pool": {
                    "healthy": True,
                    "status": "healthy",
                    "live_instances": 1,
                    "matching_release_instances": 1,
                    "workers": [{"private": "do-not-copy"}],
                },
            },
            "integrations": {
                "outbox": {"pending": 0, "retryable": 0, "poisoned": 0, "stale_leases": 0},
                "push_receipts": {"pending": 0, "due": 0, "terminal_errors": 0, "stale_leases": 0},
                "provider_secret": "do-not-copy",
            },
            "database_url": "postgresql://secret",
            "redis_url": "redis://secret",
        }
        sanitized = sampler.sanitize(raw)
        encoded = json.dumps(sanitized)
        self.assertNotIn("do-not-copy", encoded)
        self.assertNotIn("postgresql://", encoded)
        self.assertNotIn("redis://", encoded)
        self.assertEqual(sanitized["release_sha"], EXPECTED_SHA)
        self.assertEqual(sanitized["database"]["pool"]["instance_id"], "api-a")


if __name__ == "__main__":
    unittest.main()
