"""Independent *cryptographic* witness profile for a Renova execution checkpoint.

Read-only. Requires TWO independently pinned Ed25519 public keys: the Renova
checkpoint issuer and the claimed witness. A valid witness signature is
NEITHER a trusted timestamp NOR proof of organizational independence/custody.
No clock, network, database, issue/sign function or external key provisioning.
"""
from __future__ import annotations

import binascii
import hashlib
import hmac
import re
from datetime import datetime, timedelta
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.services.offline_execution_receipt import (
    HEX_SHA256,
    build_offline_receipt,
    trust_anchor_fingerprint,
)
from app.services.offline_execution_verifier import _canonical, _decode

WITNESS_VERSION = "renova-execution-witness-v1"
_WITNESS_FIELDS = frozenset({"payload", "signature", "receiptSha256"})
_SIGNED_FIELDS = frozenset({
    "witnessVersion", "alg", "witnessId", "witnessKeyId",
    "checkpointSha256", "checkpointIssuerId", "checkpointKeyId",
    "checkpointIssuedAt", "observedAt",
})
_KEY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_B64_SIGNATURE = re.compile(r"^[A-Za-z0-9_-]{86}$")
_B64_PUBLIC = re.compile(r"^u[A-Za-z0-9_-]{43}$")
_UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$"
)


def _utc_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not _UTC_TIMESTAMP.fullmatch(value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.utcoffset() != timedelta(0):
        return None
    return parsed


def verify_independent_witness(
    checkpoint: Any,
    checkpoint_key: Any,
    witness_receipt: Any,
    witness_key: Any,
    *,
    pinned_checkpoint_key_sha256: str,
    pinned_witness_key_sha256: str,
) -> dict[str, Any]:
    """Verify a witness signature over a separately verified checkpoint hash.

    The caller must independently authenticate BOTH public trust anchor pins.
    WitnessedAt is a signed *claim*, never a witnessed time source by itself.
    """
    result: dict[str, Any] = {
        "witnessVersion": WITNESS_VERSION,
        "status": "CHECKPOINT_NOT_VERIFIED",
        "checkpointIntegrityPassed": False,
        "checkpointSha256": None,
        "witnessTrustPinMatched": False,
        "witnessSignatureValid": False,
        "witnessReceiptHashValid": False,
        "checkpointHashBindingValid": False,
        "witnessChronologyConsistent": None,
        "offlineWitnessEvidencePassed": False,
        "independentWitnessTimeVerified": False,
        "witnessOrganizationalIndependenceVerified": False,
        "keyCustodyVerified": False,
        "onlineStateChecked": False,
        "canonicalProofCurrent": None,
        "revocationCurrent": None,
        "releaseAuthorized": False,
    }

    checkpoint_result = build_offline_receipt(
        checkpoint,
        checkpoint_key,
        pinned_trust_anchor_sha256=pinned_checkpoint_key_sha256,
    )
    if not checkpoint_result["offlineIntegrityPassed"]:
        return result | {"checkpointStatus": checkpoint_result["status"]}
    result["checkpointIntegrityPassed"] = True
    checkpoint_hash = checkpoint["checkpointSha256"]
    result["checkpointSha256"] = checkpoint_hash

    if (
        not isinstance(pinned_witness_key_sha256, str)
        or HEX_SHA256.fullmatch(pinned_witness_key_sha256) is None
    ):
        return result | {"status": "WITNESS_PIN_MISSING_OR_INVALID"}
    witness_fingerprint = trust_anchor_fingerprint(witness_key)
    if witness_fingerprint is None:
        return result | {"status": "WITNESS_TRUST_ANCHOR_INVALID"}
    if not hmac.compare_digest(witness_fingerprint, pinned_witness_key_sha256):
        return result | {"status": "WITNESS_TRUST_PIN_MISMATCH"}
    result["witnessTrustPinMatched"] = True
    if (
        not isinstance(witness_key, dict)
        or witness_key.get("alg") != "Ed25519"
        or witness_key.get("status") not in ("active", "retired", "revoked")
        or not isinstance(witness_key.get("publicKeyMultibase"), str)
        or _B64_PUBLIC.fullmatch(witness_key["publicKeyMultibase"]) is None
    ):
        return result | {"status": "WITNESS_TRUST_ANCHOR_INVALID"}

    # Separate identities are not enough. Refuse the exact SAME public key
    # even if it was renamed to a different witnessId/keyId.
    if witness_key["publicKeyMultibase"] == checkpoint_key.get("publicKeyMultibase"):
        return result | {"status": "WITNESS_KEY_NOT_DISTINCT"}
    if witness_key.get("issuerId") == checkpoint_key.get("issuerId"):
        return result | {"status": "WITNESS_IDENTITY_NOT_DISTINCT"}

    if not isinstance(witness_receipt, dict) or set(witness_receipt) != _WITNESS_FIELDS:
        return result | {"status": "MALFORMED_WITNESS"}
    payload = witness_receipt.get("payload")
    sig = witness_receipt.get("signature")
    signed_hash = witness_receipt.get("receiptSha256")
    if not isinstance(payload, dict) or set(payload) != _SIGNED_FIELDS:
        return result | {"status": "MALFORMED_WITNESS"}
    if (
        payload.get("witnessVersion") != WITNESS_VERSION
        or payload.get("alg") != "Ed25519"
    ):
        return result | {"status": "UNSUPPORTED_WITNESS_FORMAT"}
    if (
        not isinstance(payload.get("witnessId"), str)
        or not isinstance(payload.get("witnessKeyId"), str)
        or _KEY_ID.fullmatch(payload["witnessId"]) is None
        or _KEY_ID.fullmatch(payload["witnessKeyId"]) is None
        or witness_key.get("issuerId") != payload["witnessId"]
        or witness_key.get("keyId") != payload["witnessKeyId"]
    ):
        return result | {"status": "WITNESS_KEY_IDENTITY_MISMATCH"}
    if (
        not isinstance(payload.get("checkpointIssuerId"), str)
        or not isinstance(payload.get("checkpointKeyId"), str)
        or payload["checkpointIssuerId"] != checkpoint["payload"]["issuerId"]
        or payload["checkpointKeyId"] != checkpoint["payload"]["keyId"]
    ):
        return result | {"status": "WITNESS_CHECKPOINT_IDENTITY_MISMATCH"}
    if (
        not isinstance(sig, str) or _B64_SIGNATURE.fullmatch(sig) is None
        or not isinstance(signed_hash, str) or HEX_SHA256.fullmatch(signed_hash) is None
    ):
        return result | {"status": "MALFORMED_WITNESS"}
    if not isinstance(payload.get("checkpointSha256"), str):
        return result | {"status": "MALFORMED_WITNESS"}
    if not HEX_SHA256.fullmatch(payload["checkpointSha256"]):
        return result | {"status": "MALFORMED_WITNESS"}
    try:
        signature = _decode(sig)
        public_bytes = _decode(witness_key["publicKeyMultibase"][1:])
        if len(signature) != 64 or len(public_bytes) != 32:
            return result | {"status": "MALFORMED_WITNESS"}
        Ed25519PublicKey.from_public_bytes(public_bytes).verify(
            signature, _canonical(payload)
        )
    except (ValueError, TypeError, binascii.Error, InvalidSignature):
        return result | {"status": "WITNESS_SIGNATURE_INVALID"}
    result["witnessSignatureValid"] = True

    expected_hash = hashlib.sha256(
        _canonical({"payload": payload, "signature": sig})
    ).hexdigest()
    if not hmac.compare_digest(signed_hash, expected_hash):
        return result | {"status": "WITNESS_RECEIPT_HASH_INVALID"}
    result["witnessReceiptHashValid"] = True

    if not hmac.compare_digest(payload["checkpointSha256"], checkpoint_hash):
        return result | {"status": "WITNESS_CHECKPOINT_MISMATCH"}
    result["checkpointHashBindingValid"] = True

    # Compare a signed witness claim with a signed issuer claim. The relationship
    # alone NEVER proves that either wall-clock time was independently witnessed.
    issued_claim = _utc_datetime(checkpoint["payload"].get("issuedAt"))
    witness_copy = _utc_datetime(payload.get("checkpointIssuedAt"))
    observed_claim = _utc_datetime(payload.get("observedAt"))
    if (
        issued_claim is None or witness_copy is None or observed_claim is None
        or witness_copy != issued_claim
        or observed_claim < issued_claim
    ):
        return result | {
            "status": "WITNESS_CHRONOLOGY_INVALID",
            "witnessChronologyConsistent": False,
        }
    result["witnessChronologyConsistent"] = True

    if witness_key["status"] == "revoked":
        return result | {"status": "WITNESS_KEY_REVOKED"}
    result["status"] = "WITNESS_SIGNATURE_VERIFIED"
    result["offlineWitnessEvidencePassed"] = True
    result["witnessKeyStatusAtLocalVerification"] = witness_key["status"]
    return result
