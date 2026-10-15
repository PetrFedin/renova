"""Offline verifier for signed execution-proof trust status publications.

A publication binds one verified key-lifecycle head to a signed status snapshot.
It can prove rollback resistance only relative to an independently retained
previous-publication hash. It never claims live currentness or trusted time.
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

from app.services.execution_proof_key_lifecycle import verify_key_lifecycle

STATUS_PUBLICATION_VERSION = "renova-execution-status-publication-v1"
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_KEY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SIGNATURE = re.compile(r"^[A-Za-z0-9_-]{86}$")
_PUBLIC_KEY = re.compile(r"^u[A-Za-z0-9_-]{43}$")
_UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$"
)
_ENVELOPE_FIELDS = frozenset({"payload", "signature", "publicationSha256"})
_PAYLOAD_FIELDS = frozenset({
    "publicationVersion", "issuerId", "publicationSequence", "claimedAt",
    "lifecycleLastEventSha256", "activeKeyId", "keyStatesSha256",
    "previousPublicationSha256",
})


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


def _key_bytes(value: Any) -> bytes | None:
    if not isinstance(value, str) or _PUBLIC_KEY.fullmatch(value) is None:
        return None
    try:
        raw = _decode(value[1:])
    except (ValueError, binascii.Error):
        return None
    if len(raw) != 32:
        return None
    return raw


def _derive_active_public_key(lifecycle_bundle: dict[str, Any], root_key: dict[str, Any], active_key_id: str) -> str | None:
    material = {root_key["keyId"]: root_key["publicKeyMultibase"]}
    for event in lifecycle_bundle["events"]:
        payload = event["payload"]
        if payload.get("eventType") == "ROTATE":
            material[payload["newKeyId"]] = payload["newPublicKeyMultibase"]
    return material.get(active_key_id)


def verify_status_publication(
    publication: Any,
    lifecycle_bundle: Any,
    root_key: Any,
    *,
    pinned_root_key_sha256: str,
    pinned_previous_publication_sha256: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "publicationVersion": STATUS_PUBLICATION_VERSION,
        "status": "MALFORMED_PUBLICATION",
        "lifecycleVerified": False,
        "publicationSignatureValid": False,
        "publicationHashValid": False,
        "lifecycleHeadBound": False,
        "keyStatesBound": False,
        "rollbackPinMatched": False,
        "rollbackProtectedByPin": False,
        "publicationVerified": False,
        "externalTimeVerified": False,
        "onlineStateChecked": False,
        "currentPublicationKnown": False,
        "keyCustodyVerified": False,
        "organizationalAuthorityVerified": False,
        "releaseAuthorized": False,
    }

    lifecycle = verify_key_lifecycle(
        lifecycle_bundle,
        root_key,
        pinned_root_key_sha256=pinned_root_key_sha256,
    )
    if not lifecycle.get("lifecycleValid"):
        return result | {"status": "LIFECYCLE_NOT_VERIFIED", "lifecycleStatus": lifecycle.get("status")}
    result["lifecycleVerified"] = True

    active_key_id = lifecycle.get("activeKeyId")
    if not isinstance(active_key_id, str):
        return result | {"status": "NO_ACTIVE_LIFECYCLE_KEY"}

    if not isinstance(publication, dict) or set(publication) != _ENVELOPE_FIELDS:
        return result
    payload = publication.get("payload")
    signature_value = publication.get("signature")
    publication_sha = publication.get("publicationSha256")
    if (
        not isinstance(payload, dict)
        or set(payload) != _PAYLOAD_FIELDS
        or not isinstance(signature_value, str)
        or _SIGNATURE.fullmatch(signature_value) is None
        or not isinstance(publication_sha, str)
        or _HEX_SHA256.fullmatch(publication_sha) is None
    ):
        return result

    sequence = payload.get("publicationSequence")
    previous_sha = payload.get("previousPublicationSha256")
    if (
        payload.get("publicationVersion") != STATUS_PUBLICATION_VERSION
        or payload.get("issuerId") != lifecycle_bundle.get("issuerId")
        or not isinstance(sequence, int)
        or isinstance(sequence, bool)
        or sequence < 0
        or _utc(payload.get("claimedAt")) is None
        or payload.get("activeKeyId") != active_key_id
        or payload.get("lifecycleLastEventSha256") != lifecycle.get("lastEventSha256")
    ):
        return result | {"status": "PUBLICATION_IDENTITY_MISMATCH"}
    result["lifecycleHeadBound"] = True

    if sequence == 0:
        if previous_sha is not None:
            return result | {"status": "PUBLICATION_PREVIOUS_HASH_INVALID"}
    else:
        if not isinstance(previous_sha, str) or _HEX_SHA256.fullmatch(previous_sha) is None:
            return result | {"status": "PUBLICATION_PREVIOUS_HASH_INVALID"}

    states_hash = hashlib.sha256(_canonical(lifecycle.get("keyStates"))).hexdigest()
    if not hmac.compare_digest(str(payload.get("keyStatesSha256") or ""), states_hash):
        return result | {"status": "PUBLICATION_KEY_STATES_MISMATCH"}
    result["keyStatesBound"] = True

    active_public = _derive_active_public_key(lifecycle_bundle, root_key, active_key_id)
    public_raw = _key_bytes(active_public)
    if public_raw is None:
        return result | {"status": "ACTIVE_PUBLIC_KEY_UNAVAILABLE"}
    try:
        signature = _decode(signature_value)
        if len(signature) != 64:
            return result | {"status": "PUBLICATION_SIGNATURE_INVALID"}
        Ed25519PublicKey.from_public_bytes(public_raw).verify(signature, _canonical(payload))
    except (ValueError, TypeError, binascii.Error, InvalidSignature):
        return result | {"status": "PUBLICATION_SIGNATURE_INVALID"}
    result["publicationSignatureValid"] = True

    expected_sha = hashlib.sha256(_canonical({"payload": payload, "signature": signature_value})).hexdigest()
    if not hmac.compare_digest(expected_sha, publication_sha):
        return result | {"status": "PUBLICATION_HASH_INVALID"}
    result["publicationHashValid"] = True

    if pinned_previous_publication_sha256 is not None:
        if (
            not isinstance(pinned_previous_publication_sha256, str)
            or _HEX_SHA256.fullmatch(pinned_previous_publication_sha256) is None
            or sequence == 0
            or previous_sha is None
            or not hmac.compare_digest(previous_sha, pinned_previous_publication_sha256)
            or hmac.compare_digest(publication_sha, pinned_previous_publication_sha256)
        ):
            return result | {"status": "PUBLICATION_ROLLBACK_PIN_MISMATCH"}
        result["rollbackPinMatched"] = True
        result["rollbackProtectedByPin"] = True

    return result | {
        "status": "STATUS_PUBLICATION_VERIFIED",
        "publicationVerified": True,
        "publicationSequence": sequence,
        "publicationSha256": publication_sha,
        "previousPublicationSha256": previous_sha,
        "lifecycleLastEventSha256": lifecycle["lastEventSha256"],
        "activeKeyId": active_key_id,
    }
