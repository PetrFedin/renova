"""Pure offline Ed25519 checkpoint verification against PRE-PINNED public trust.

Never claims real-time canonical state, independently witnessed issuance time,
signing key custody or online revocation. No network or database access.
"""
from __future__ import annotations
import base64
import binascii
import hashlib
import json
import re
from typing import Any
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

VERSION = "renova-execution-checkpoint-v1"
B64 = re.compile(r"^[A-Za-z0-9_-]{86}$")
PUB = re.compile(r"^u[A-Za-z0-9_-]{43}$")
HEX = re.compile(r"^[0-9a-f]{64}$")


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")


def _decode(value: str) -> bytes:
    raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != value:
        raise ValueError("noncanonical base64url")
    return raw


def verify_offline(envelope: Any, trusted_key: Any) -> dict[str, Any]:
    """trusted_key is caller-pinned from a separate trusted channel, never envelope."""
    result: dict[str, Any] = {
        "status": "INVALID", "cryptographicSignatureValid": False,
        "checkpointHashValid": False, "onlineStateChecked": False,
        "keyCustodyVerified": False, "issuanceTimeIndependentlyVerified": False,
        "canonicalProofCurrent": None, "revocationCurrent": None,
    }
    if not isinstance(envelope, dict) or not isinstance(trusted_key, dict):
        return result | {"status": "MALFORMED_INPUT"}
    # Canonical checkpoints contain exactly three envelope fields. Extra
    # top-level metadata is NOT protected by the Ed25519 signature or hash.
    if set(envelope) != {"payload", "signature", "checkpointSha256"}:
        return result | {"status": "MALFORMED_INPUT"}
    payload, sig = envelope.get("payload"), envelope.get("signature")
    digest = envelope.get("checkpointSha256")
    if not isinstance(payload, dict) or not isinstance(payload.get("subject"), dict):
        return result | {"status": "MALFORMED_INPUT"}
    if not isinstance(sig, str) or not B64.fullmatch(sig) or not isinstance(digest, str) or not HEX.fullmatch(digest):
        return result | {"status": "MALFORMED_INPUT"}
    if payload.get("checkpointVersion") != VERSION or payload.get("alg") != "Ed25519":
        return result | {"status": "UNSUPPORTED_FORMAT"}
    if not all(isinstance(payload.get(k), str) and payload[k] for k in ("issuerId", "keyId")):
        return result | {"status": "MALFORMED_INPUT"}
    if trusted_key.get("issuerId") != payload["issuerId"] or trusted_key.get("keyId") != payload["keyId"]:
        return result | {"status": "UNTRUSTED_KEY"}
    if trusted_key.get("alg") != "Ed25519" or trusted_key.get("status") not in ("active", "retired", "revoked"):
        return result | {"status": "INVALID_TRUST_ANCHOR"}
    pub = trusted_key.get("publicKeyMultibase")
    if not isinstance(pub, str) or not PUB.fullmatch(pub):
        return result | {"status": "INVALID_TRUST_ANCHOR"}
    try:
        signature = _decode(sig)
        key_bytes = _decode(pub[1:])
        if len(signature) != 64 or len(key_bytes) != 32:
            return result | {"status": "MALFORMED_INPUT"}
        Ed25519PublicKey.from_public_bytes(key_bytes).verify(signature, _canonical(payload))
    except (ValueError, TypeError, binascii.Error, InvalidSignature):
        return result | {"status": "INVALID_SIGNATURE"}
    result["cryptographicSignatureValid"] = True
    expected = hashlib.sha256(_canonical({"payload": payload, "signature": sig})).hexdigest()
    result["checkpointHashValid"] = expected == digest
    if not result["checkpointHashValid"]:
        return result | {"status": "INVALID_CHECKPOINT_HASH"}
    if trusted_key["status"] == "revoked":
        return result | {"status": "REVOKED_KEY"}
    return result | {"status": "OFFLINE_SIGNATURE_VERIFIED", "keyStatus": trusted_key["status"]}
