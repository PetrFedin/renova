#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("production_readiness.py")
SPEC = importlib.util.spec_from_file_location("renova_production_readiness", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load production_readiness.py")
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)

SHA = "a" * 40
OTHER_SHA = "b" * 40
IMAGE = "ghcr.io/petrfedin/renova-api"
DIGEST = "sha256:" + "c" * 64


class ProductionReadinessPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.facts = readiness.repo_facts()
        self.evidence = json.loads(readiness.EVIDENCE_PATH.read_text(encoding="utf-8"))

    def test_current_blocked_manifest_is_valid(self) -> None:
        readiness._validate_manifest(deepcopy(self.evidence), self.facts)

    def test_ready_with_zero_blockers_is_structurally_valid(self) -> None:
        evidence = deepcopy(self.evidence)
        evidence["open_launch_blockers"] = []
        evidence["launch_decision"] = {
            "status": "READY_FOR_BROAD_PRODUCTION",
            "reason": "All tracked broad-production launch blockers have authoritative evidence.",
        }
        readiness._validate_manifest(evidence, self.facts)

    def test_ready_with_blockers_fails(self) -> None:
        evidence = deepcopy(self.evidence)
        evidence["launch_decision"]["status"] = "READY_FOR_BROAD_PRODUCTION"
        with self.assertRaisesRegex(readiness.ReadinessError, "READY is forbidden"):
            readiness._validate_manifest(evidence, self.facts)

    def test_blocked_with_zero_blockers_requires_reason(self) -> None:
        evidence = deepcopy(self.evidence)
        evidence["open_launch_blockers"] = []
        evidence["launch_decision"] = {
            "status": "BLOCKED_FOR_BROAD_PRODUCTION",
            "reason": "",
        }
        with self.assertRaisesRegex(readiness.ReadinessError, "reason must be non-empty"):
            readiness._validate_manifest(evidence, self.facts)

    def test_unknown_launch_status_fails(self) -> None:
        evidence = deepcopy(self.evidence)
        evidence["launch_decision"]["status"] = "READY_ENOUGH"
        with self.assertRaisesRegex(readiness.ReadinessError, "invalid launch_decision.status"):
            readiness._validate_manifest(evidence, self.facts)

    def test_external_verified_status_without_evidence_fails(self) -> None:
        evidence = deepcopy(self.evidence)
        evidence["environments"]["production"] = {
            "status": "VERIFIED",
            "evidence": None,
        }
        with self.assertRaisesRegex(readiness.ReadinessError, "requires evidence"):
            readiness._validate_manifest(evidence, self.facts)

    def test_closed_github_blocker_still_in_manifest_fails(self) -> None:
        blockers = [{"issue": 247, "priority": "P0", "reason": "test"}]
        branch = {"commit": {"sha": SHA}, "protected": True}
        issue = {"state": "closed"}
        with mock.patch.object(readiness, "_github_json", side_effect=[branch, issue]):
            with self.assertRaisesRegex(readiness.ReadinessError, "GitHub state is closed"):
                readiness.github_truth("PetrFedin/renova", None, blockers)

    def test_identity_sha_must_equal_evaluated_sha(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "identity.json"
            path.write_text(json.dumps({"git_sha": OTHER_SHA}), encoding="utf-8")
            with self.assertRaisesRegex(readiness.ReadinessError, "does not match evaluated SHA"):
                readiness._load_optional_identity(
                    str(path),
                    "test",
                    expected_sha=SHA,
                )

    def _backend_identity(self) -> dict[str, object]:
        return {
            "git_sha": SHA,
            "oci_revision": SHA,
            "image": IMAGE,
            "tag": f"{IMAGE}:sha-{SHA}",
            "digest": DIGEST,
            "runtime_commands": ["renova-api", "renova-worker"],
            "sbom": True,
            "provenance": "mode=max",
            "signature": "sigstore-keyless",
            "evidence": "https://github.com/PetrFedin/renova/actions/runs/1",
        }

    def test_backend_identity_accepts_exact_release(self) -> None:
        readiness._validate_backend_image_identity(
            self._backend_identity(),
            {"image": IMAGE},
            expected_sha=SHA,
        )

    def test_backend_identity_rejects_wrong_image_tag_revision_or_digest(self) -> None:
        cases = {
            "image": {"image": "ghcr.io/petrfedin/not-renova"},
            "tag": {"tag": f"{IMAGE}:latest"},
            "oci_revision": {"oci_revision": OTHER_SHA},
            "missing_digest": {"digest": None},
            "invalid_digest": {"digest": "sha256:not-a-digest"},
        }
        for name, mutation in cases.items():
            with self.subTest(name=name):
                identity = self._backend_identity()
                identity.update(mutation)
                with self.assertRaises(readiness.ReadinessError):
                    readiness._validate_backend_image_identity(
                        identity,
                        {"image": IMAGE},
                        expected_sha=SHA,
                    )

    def _eas_identity(self) -> dict[str, object]:
        return {
            "git_sha": SHA,
            "app_version": self.facts["mobile_version"],
            "ios_build_number": self.facts["ios_build_number"],
            "android_version_code": self.facts["android_version_code"],
            "profile": "testflight",
            "requested_platform": "ios",
            "message": "exact release",
            "evidence": "https://github.com/PetrFedin/renova/actions/runs/2",
            "builds": [{"platform": "ios", "id": "eas-build-id"}],
        }

    def test_eas_identity_accepts_exact_native_build(self) -> None:
        readiness._validate_eas_release_identity(
            self._eas_identity(),
            self.facts,
            expected_sha=SHA,
        )

    def test_eas_identity_rejects_wrong_version_or_native_build(self) -> None:
        cases = {
            "app_version": {"app_version": "999.0.0"},
            "ios_build_number": {"ios_build_number": "999"},
            "android_version_code": {"android_version_code": 999},
            "missing_evidence": {"evidence": ""},
        }
        for name, mutation in cases.items():
            with self.subTest(name=name):
                identity = self._eas_identity()
                identity.update(mutation)
                with self.assertRaises(readiness.ReadinessError):
                    readiness._validate_eas_release_identity(
                        identity,
                        self.facts,
                        expected_sha=SHA,
                    )


if __name__ == "__main__":
    unittest.main(verbosity=2)
