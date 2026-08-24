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
EVIDENCE_URL = "https://github.com/PetrFedin/renova/actions/runs/1"


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
            "evidence": EVIDENCE_URL,
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

    @staticmethod
    def _verified_external(**extra: object) -> dict[str, object]:
        return {
            "status": "VERIFIED",
            "evidence": EVIDENCE_URL,
            **extra,
        }

    def _fully_verified_ready_snapshot(self) -> dict[str, object]:
        snapshot = deepcopy(self.evidence)
        snapshot["launch_decision"] = {
            "status": "READY_FOR_BROAD_PRODUCTION",
            "reason": "All production gates have retained authoritative evidence.",
        }
        snapshot["open_launch_blockers"] = []
        snapshot["snapshot"] = {
            "evaluated_git_sha": SHA,
            "git_ref": "main",
            "current_main_sha": SHA,
            "github_metadata_checked": True,
            "main_protected": True,
        }
        snapshot["backend_artifact"] = {
            **snapshot["backend_artifact"],
            "status": "VERIFIED",
            "git_sha": SHA,
            "digest": DIGEST,
            "evidence": EVIDENCE_URL,
        }
        snapshot["environments"]["staging"] = self._verified_external(
            git_sha=SHA,
            artifact_digest=DIGEST,
        )
        snapshot["slo"]["latest_external_load_test"] = self._verified_external(
            git_sha=SHA,
            artifact_digest=DIGEST,
        )
        snapshot["restore"]["latest_production_restore_drill"] = self._verified_external(
            rpo_minutes=5,
            rto_minutes=30,
        )
        snapshot["release"]["latest_eas_release"] = self._verified_external(
            git_sha=SHA,
            builds=[{"platform": "ios", "id": "eas-build-id"}],
        )
        snapshot["observability"] = self._verified_external(
            alert_delivery_verified=True,
            mobile_crash_reporting_verified=True,
        )
        for provider_state in snapshot["providers"].values():
            provider_state["release_scope"] = True
            provider_state["external_status"] = "VERIFIED"
            provider_state["evidence"] = EVIDENCE_URL
        snapshot["security"]["external_validation"] = {
            "branch_protection": self._verified_external(),
            "privileged_access_review": self._verified_external(),
            "independent_pentest": self._verified_external(),
            "provider_credential_rotation_drill": self._verified_external(),
        }
        snapshot["launch_acceptance"] = {
            "controlled_pilot": self._verified_external(),
            "product_telemetry": self._verified_external(),
            "legal_privacy": self._verified_external(),
            "support_incident_ops": self._verified_external(),
        }
        return snapshot

    def test_zero_blockers_cannot_fake_ready_without_external_evidence(self) -> None:
        snapshot = deepcopy(self.evidence)
        snapshot["launch_decision"] = {
            "status": "READY_FOR_BROAD_PRODUCTION",
            "reason": "Pretend ready",
        }
        snapshot["open_launch_blockers"] = []
        snapshot["snapshot"] = {
            "evaluated_git_sha": SHA,
            "git_ref": "main",
            "current_main_sha": SHA,
            "github_metadata_checked": True,
            "main_protected": True,
        }
        with self.assertRaisesRegex(readiness.ReadinessError, "verified immutable backend artifact"):
            readiness._validate_ready_snapshot(snapshot)

    def test_fully_evidenced_ready_state_is_reachable(self) -> None:
        snapshot = self._fully_verified_ready_snapshot()
        readiness._validate_ready_snapshot(snapshot)

    def test_ready_requires_same_sha_and_digest_for_staging_and_load(self) -> None:
        snapshot = self._fully_verified_ready_snapshot()
        snapshot["environments"]["staging"]["artifact_digest"] = "sha256:" + "d" * 64
        with self.assertRaisesRegex(readiness.ReadinessError, "artifact_digest == backend digest"):
            readiness._validate_ready_snapshot(snapshot)

    def test_provider_exclusion_requires_explicit_scope_reason(self) -> None:
        snapshot = self._fully_verified_ready_snapshot()
        snapshot["providers"]["moy_nalog"] = {
            "release_scope": False,
            "scope_reason": "",
        }
        with self.assertRaisesRegex(readiness.ReadinessError, "excluded from release scope without reason"):
            readiness._validate_ready_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main(verbosity=2)
