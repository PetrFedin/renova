"""Offline verifier for Renova execution-proof key lifecycle receipts.

This module verifies a hash-linked key lifecycle using an independently pinned
root public key. It is deliberately read-only: it does not provision keys,
sign events, mutate database state, or claim trusted wall-clock time.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

LIFECYCLE_VERSION = "renova-execution-key-lifecycle-v1"

_KEY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_PUBLIC_KEY = re.compile(r"^u[A-Za-z0-9_-]{43}$")
_SIGNATURE = re.compile(r"^[A-Za-z0-9_-]{86}$")
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$"
)
_ROOT_FIELDS = frozenset({"issuerId", "keyId", "alg", "status", "publicKeyMultibase"})
_EVENT_FIELDS = frozenset({"payload", "signatures", "eventSha256"})
_SIGNATURE_FIELDS = frozenset({"alg", "signature"})
_GENESIS_FIELDS = frozenset({
    "lifecycleVersion", "sequence", "issuerId", "eventType", "keyId",
    "publicKeyMultibase", "claimedAt", "previousEventSha256",
})
_ROTATE_FIELDS = frozenset({
    "lifecycleVersion", "sequence", "issuerId", "eventType", "oldKeyId",
    "newKeyId", "newPublicKeyMultibase", "claimedAt", "previousEventSha256",
})
_REVOKE_FIELDS = frozenset({
    "lifecycleVersion", "sequence", "issuerId", "eventType", "targetKeyId",
    "claimedAt", "previousEventSha256",
})
_MAX_EVENTS = 256


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or _UTC_TIMESTAMP.fullmatch(value) is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.utcoffset() != timedelta(0):
        return None
    return parsed


def _key_bytes(public_value: Any) -> bytes | None:
    if not isinstance(public_value, str) or _PUBLIC_KEY.fullmatch(public_value) is None:
        return None
    try:
        raw = _decode(public_value[1:])
    except (ValueError, binascii.Error):
        return None
    if len(raw) != 32:
        return None
    if "u" + base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != public_value:
        return None
    return raw


def _root_fingerprint(root_key: Any) -> str | None:
    if not isinstance(root_key, dict) or set(root_key) != _ROOT_FIELDS:
        return None
    issuer_id = root_key.get("issuerId")
    key_id = root_key.get("keyId")
    if (
        not isinstance(issuer_id, str)
        or _KEY_ID.fullmatch(issuer_id) is None
        or not isinstance(key_id, str)
        or _KEY_ID.fullmatch(key_id) is None
        or root_key.get("alg") != "Ed25519"
        or root_key.get("status") != "active"
        or _key_bytes(root_key.get("publicKeyMultibase")) is None
    ):
        return None
    return hashlib.sha256(_canonical(root_key)).hexdigest()


def _verify_signature(public_value: str, signature_value: str, payload: dict[str, Any]) -> bool:
    if not isinstance(signature_value, str) or _SIGNATURE.fullmatch(signature_value) is None:
        return False
    public_raw = _key_bytes(public_value)
    if public_raw is None:
        return False
    try:
        signature = _decode(signature_value)
        if len(signature) != 64:
            return False
        Ed25519PublicKey.from_public_bytes(public_raw).verify(signature, _canonical(payload))
        return True
    except (ValueError, TypeError, binascii.Error, InvalidSignature):
        return False


def _deny(status: str, result: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return result | {"status": status, **extra}


def verify_key_lifecycle(
    bundle: Any,
    root_key: Any,
    *,
    pinned_root_key_sha256: str,
) -> dict[str, Any]:
    """Verify an offline key lifecycle without overstating institutional trust.

    `pinned_root_key_sha256` must be obtained out of band. Claimed timestamps are
    checked for syntax/order only; no trusted timestamp or custody is inferred.
    """
    result: dict[str, Any] = {
        "lifecycleVersion": LIFECYCLE_VERSION,
        "status": "MALFORMED_LIFECYCLE",
        "rootPinMatched": False,
        "chainHashValid": False,
        "signaturesValid": False,
        "claimedChronologyConsistent": None,
        "lifecycleValid": False,
        "activeKeyId": None,
        "keyStates": {},
        "lastEventSha256": None,
        "externalTimeVerified": False,
        "keyCustodyVerified": False,
        "organizationalAuthorityVerified": False,
        "onlineStateChecked": False,
        "releaseAuthorized": False,
    }

    if not isinstance(pinned_root_key_sha256, str) or _HEX_SHA256.fullmatch(pinned_root_key_sha256) is None:
        return _deny("ROOT_PIN_MISSING_OR_INVALID", result)
    root_fingerprint = _root_fingerprint(root_key)
    if root_fingerprint is None:
        return _deny("ROOT_KEY_INVALID", result)
    if not hmac.compare_digest(root_fingerprint, pinned_root_key_sha256):
        return _deny("ROOT_PIN_MISMATCH", result)
    result["rootPinMatched"] = True

    if not isinstance(bundle, dict) or set(bundle) != {"lifecycleVersion", "issuerId", "events"}:
        return _deny("MALFORMED_LIFECYCLE", result)
    if bundle.get("lifecycleVersion") != LIFECYCLE_VERSION:
        return _deny("UNSUPPORTED_LIFECYCLE_VERSION", result)
    issuer_id = bundle.get("issuerId")
    events = bundle.get("events")
    if (
        not isinstance(issuer_id, str)
        or _KEY_ID.fullmatch(issuer_id) is None
        or issuer_id != root_key["issuerId"]
        or not isinstance(events, list)
        or not 1 <= len(events) <= _MAX_EVENTS
    ):
        return _deny("MALFORMED_LIFECYCLE", result)

    key_material: dict[str, str] = {root_key["keyId"]: root_key["publicKeyMultibase"]}
    key_states: dict[str, str] = {}
    active_key_id: str | None = None
    prior_hash: str | None = None
    prior_claimed_at: datetime | None = None

    for index, event in enumerate(events):
        if not isinstance(event, dict) or set(event) != _EVENT_FIELDS:
            return _deny("MALFORMED_EVENT", result, failedSequence=index)
        payload = event.get("payload")
        signatures = event.get("signatures")
        supplied_hash = event.get("eventSha256")
        if (
            not isinstance(payload, dict)
            or not isinstance(signatures, dict)
            or not isinstance(supplied_hash, str)
            or _HEX_SHA256.fullmatch(supplied_hash) is None
        ):
            return _deny("MALFORMED_EVENT", result, failedSequence=index)

        event_type = payload.get("eventType")
        expected_fields = {
            "GENESIS": _GENESIS_FIELDS,
            "ROTATE": _ROTATE_FIELDS,
            "REVOKE": _REVOKE_FIELDS,
        }.get(event_type)
        if expected_fields is None or set(payload) != expected_fields:
            return _deny("MALFORMED_EVENT", result, failedSequence=index)
        if (
            payload.get("lifecycleVersion") != LIFECYCLE_VERSION
            or payload.get("sequence") != index
            or payload.get("issuerId") != issuer_id
        ):
            return _deny("EVENT_IDENTITY_MISMATCH", result, failedSequence=index)
        if payload.get("previousEventSha256") != prior_hash:
            return _deny("CHAIN_PREVIOUS_HASH_MISMATCH", result, failedSequence=index)

        claimed_at = _utc(payload.get("claimedAt"))
        if claimed_at is None:
            return _deny("CLAIMED_TIME_INVALID", result, failedSequence=index)
        if prior_claimed_at is not None and claimed_at < prior_claimed_at:
            result["claimedChronologyConsistent"] = False
            return _deny("CLAIMED_CHRONOLOGY_REVERSED", result, failedSequence=index)

        expected_hash = hashlib.sha256(_canonical({"payload": payload, "signatures": signatures})).hexdigest()
        if not hmac.compare_digest(expected_hash, supplied_hash):
            return _deny("EVENT_HASH_INVALID", result, failedSequence=index)

        for signer_id, record in signatures.items():
            if (
                not isinstance(signer_id, str)
                or _KEY_ID.fullmatch(signer_id) is None
                or not isinstance(record, dict)
                or set(record) != _SIGNATURE_FIELDS
                or record.get("alg") != "Ed25519"
            ):
                return _deny("MALFORMED_SIGNATURE", result, failedSequence=index)

        if event_type == "GENESIS":
            key_id = payload.get("keyId")
            public_value = payload.get("publicKeyMultibase")
            if index != 0 or prior_hash is not None:
                return _deny("GENESIS_POSITION_INVALID", result, failedSequence=index)
            if (
                key_id != root_key["keyId"]
                or public_value != root_key["publicKeyMultibase"]
                or set(signatures) != {key_id}
                or not _verify_signature(public_value, signatures[key_id]["signature"], payload)
            ):
                return _deny("GENESIS_ROOT_PROOF_INVALID", result, failedSequence=index)
            key_states[key_id] = "active"
            active_key_id = key_id

        elif event_type == "ROTATE":
            old_key_id = payload.get("oldKeyId")
            new_key_id = payload.get("newKeyId")
            new_public = payload.get("newPublicKeyMultibase")
            if (
                not isinstance(old_key_id, str)
                or not isinstance(new_key_id, str)
                or _KEY_ID.fullmatch(old_key_id) is None
                or _KEY_ID.fullmatch(new_key_id) is None
                or old_key_id != active_key_id
                or key_states.get(old_key_id) != "active"
                or new_key_id in key_states
                or new_key_id in key_material
                or _key_bytes(new_public) is None
                or new_public in key_material.values()
                or set(signatures) != {old_key_id, new_key_id}
            ):
                return _deny("ROTATION_TRANSITION_INVALID", result, failedSequence=index)
            if not _verify_signature(key_material[old_key_id], signatures[old_key_id]["signature"], payload):
                return _deny("ROTATION_OLD_KEY_SIGNATURE_INVALID", result, failedSequence=index)
            if not _verify_signature(new_public, signatures[new_key_id]["signature"], payload):
                return _deny("ROTATION_NEW_KEY_SIGNATURE_INVALID", result, failedSequence=index)
            key_states[old_key_id] = "retired"
            key_material[new_key_id] = new_public
            key_states[new_key_id] = "active"
            active_key_id = new_key_id

        else:  # REVOKE
            target_key_id = payload.get("targetKeyId")
            if (
                not isinstance(target_key_id, str)
                or _KEY_ID.fullmatch(target_key_id) is None
                or target_key_id not in key_states
                or key_states[target_key_id] == "revoked"
                or active_key_id is None
                or key_states.get(active_key_id) != "active"
                or set(signatures) != {active_key_id}
            ):
                return _deny("REVOCATION_TRANSITION_INVALID", result, failedSequence=index)
            if not _verify_signature(key_material[active_key_id], signatures[active_key_id]["signature"], payload):
                return _deny("REVOCATION_SIGNATURE_INVALID", result, failedSequence=index)
            key_states[target_key_id] = "revoked"
            if target_key_id == active_key_id:
                active_key_id = None

        prior_hash = supplied_hash
        prior_claimed_at = claimed_at

    result.update({
        "status": "LIFECYCLE_VERIFIED",
        "chainHashValid": True,
        "signaturesValid": True,
        "claimedChronologyConsistent": True,
        "lifecycleValid": True,
        "activeKeyId": active_key_id,
        "keyStates": dict(sorted(key_states.items())),
        "lastEventSha256": prior_hash,
    })
    return result
