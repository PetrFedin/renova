"""Deterministic OFFLINE evidence receipt, not a release or current-state decision.

The trust anchor fingerprint MUST be obtained by the verifier through a
separate trusted channel. A registry shipped alongside a proof is never
self-authenticating. No network, database, clock, private signing key or I/O.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.services.offline_execution_verifier import verify_offline

RECEIPT_VERSION = "renova-offline-verification-receipt-v1"
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
TRUST_FIELDS = frozenset(
    {"issuerId", "keyId", "alg", "status", "publicKeyMultibase"}
)
LIMITATIONS = (
    "No authenticated source or custody of the public key is established by this tool.",
    "No independently witnessed issuance timestamp is established.",
    "Canonical acceptance and execution records were not queried.",
    "Current certificate, signing-key and checkpoint revocations were not queried.",
    "Offline integrity does not authorize funding, insurance or production release.",
)


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")


def trust_anchor_fingerprint(key: Any) -> str | None:
    """Pin the whole key *identity and status*, not just the Ed25519 bytes."""
    if not isinstance(key, dict) or set(key) != TRUST_FIELDS:
        return None
    if not all(isinstance(v, str) for v in key.values()):
        return None
    try:
        return hashlib.sha256(_canonical(key)).hexdigest()
    except (ValueError, TypeError, OverflowError):
        return None


def build_offline_receipt(
    envelope: Any,
    trusted_key: Any,
    *,
    pinned_trust_anchor_sha256: str,
) -> dict[str, Any]:
    """Check a separately pinned key first; then call the offline verifier.

    Hashes here describe the provided *input bytes after JSON canonicalization*.
    They are not anchors to an external ledger or timestamps.
    """
    fingerprint = trust_anchor_fingerprint(trusted_key)
    pinned = (
        isinstance(pinned_trust_anchor_sha256, str)
        and HEX_SHA256.fullmatch(pinned_trust_anchor_sha256) is not None
    )
    base: dict[str, Any] = {
        "receiptVersion": RECEIPT_VERSION,
        "status": "TRUST_ANCHOR_INVALID",
        "offlineIntegrityPassed": False,
        "releaseAuthorized": False,
        "cryptographicSignatureValid": False,
        "checkpointHashValid": False,
        "trustAnchorSha256": fingerprint,
        "pinnedTrustAnchorMatched": False,
        "envelopeSha256": None,
        "checkpointSha256": None,
        "onlineStateChecked": False,
        "canonicalProofCurrent": None,
        "revocationCurrent": None,
        "issuanceTimeIndependentlyVerified": False,
        "keyCustodyVerified": False,
        "limitations": list(LIMITATIONS),
    }
    if not pinned:
        return base | {"status": "PIN_MISSING_OR_INVALID"}
    if fingerprint is None:
        return base
    if fingerprint != pinned_trust_anchor_sha256:
        return base | {"status": "TRUST_PIN_MISMATCH"}
    base["pinnedTrustAnchorMatched"] = True
    if isinstance(envelope, dict):
        try:
            base["envelopeSha256"] = hashlib.sha256(_canonical(envelope)).hexdigest()
        except (ValueError, TypeError, OverflowError):
            pass
        supplied = envelope.get("checkpointSha256")
        if isinstance(supplied, str) and HEX_SHA256.fullmatch(supplied):
            base["checkpointSha256"] = supplied

    verified = verify_offline(envelope, trusted_key)
    base["status"] = verified["status"]
    base["cryptographicSignatureValid"] = verified["cryptographicSignatureValid"]
    base["checkpointHashValid"] = verified["checkpointHashValid"]
    base["offlineIntegrityPassed"] = verified["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    if base["offlineIntegrityPassed"]:
        base["signedIssuerId"] = envelope["payload"]["issuerId"]
        base["signedKeyId"] = envelope["payload"]["keyId"]
        base["keyStatusAtLocalVerification"] = trusted_key["status"]
    return base
