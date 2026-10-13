"""Cryptographic trust layer for portable Renova execution proofs.

The platform issuer signs only a checkpoint over the canonical portable proof.
It does not impersonate a contractor/customer signature. Current validity is
checked against both the revocation ledger and the current canonical proof hash.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services import verified_execution_record_service as execution_records
from app.services import execution_proof_key_registry as key_registry


CHECKPOINT_VERSION = "renova-execution-checkpoint-v1"


class ExecutionIssuerNotConfigured(RuntimeError):
    code = "execution_issuer_not_configured"


class InvalidExecutionCheckpoint(ValueError):
    code = "invalid_execution_checkpoint"


def _canonical_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    value = str(value or "")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _private_key() -> Ed25519PrivateKey:
    raw = settings.execution_proof_signing_private_key_b64
    if not raw:
        raise ExecutionIssuerNotConfigured("execution_issuer_not_configured")
    try:
        decoded = _b64url_decode(raw)
        if len(decoded) != 32:
            raise ValueError("invalid signing key length")
        return Ed25519PrivateKey.from_private_bytes(decoded)
    except (ValueError, binascii.Error) as exc:
        raise ExecutionIssuerNotConfigured("execution_issuer_key_invalid") from exc


def _issuer_private_key() -> Ed25519PrivateKey:
    private = _private_key()
    keys = key_registry.load_trusted_keys()
    if keys is not None:
        active = key_registry.resolve_trusted_key(
            keys,
            issuer_id=settings.execution_proof_issuer_id,
            key_id=settings.execution_proof_signing_key_id,
        )
        actual_public = private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        if active is None or active.status != "active" or active.public_key_bytes != actual_public:
            raise ExecutionIssuerNotConfigured("execution_issuer_key_not_active")
    return private


def public_keys_document() -> dict[str, Any]:
    """Public verification material; does not require access to signing keys."""
    keys = key_registry.load_trusted_keys()
    if keys is None:
        private = _private_key()  # legacy key, only if present
        raw = private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return {
            "checkpointVersion": CHECKPOINT_VERSION,
            "keys": [{
                "issuerId": settings.execution_proof_issuer_id,
                "keyId": settings.execution_proof_signing_key_id,
                "alg": "Ed25519",
                "status": "active",
                "publicKeyMultibase": "u" + _b64url_encode(raw),
            }],
        }
    return {"checkpointVersion": CHECKPOINT_VERSION, "keys": [key.public_document() for key in keys]}


def public_key_document() -> dict[str, Any]:
    private = _issuer_private_key()
    raw = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return {
        "issuerId": settings.execution_proof_issuer_id,
        "keyId": settings.execution_proof_signing_key_id,
        "alg": "Ed25519",
        "publicKeyMultibase": "u" + _b64url_encode(raw),
        "checkpointVersion": CHECKPOINT_VERSION,
    }


async def issue_checkpoint(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> dict[str, Any]:
    proof = await execution_records.get_portable_execution_proof(
        db,
        project_id=project_id,
        stage_id=stage_id,
    )
    issued_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "checkpointVersion": CHECKPOINT_VERSION,
        "issuerId": settings.execution_proof_issuer_id,
        "keyId": settings.execution_proof_signing_key_id,
        "alg": "Ed25519",
        "issuedAt": issued_at,
        "subject": {
            "projectId": project_id,
            "stageId": stage_id,
        },
        "proofHashSha256": proof["proofHashSha256"],
        "sourceRecordHashSha256": proof["sourceRecordHashSha256"],
        "evidenceLevel": proof["evidence"]["level"],
        "acceptanceStatus": proof["acceptance"]["status"],
    }
    signature = _issuer_private_key().sign(_canonical_bytes(payload))
    envelope = {
        "payload": payload,
        "signature": _b64url_encode(signature),
    }
    envelope["checkpointSha256"] = hashlib.sha256(_canonical_bytes(envelope)).hexdigest()
    return envelope


def verify_signature(envelope: dict[str, Any]) -> tuple[bool, str | None]:
    # The public verifier receives untrusted JSON. Reject invalid nested
    # shapes before dereferencing payload or attempting base64 decode.
    if not isinstance(envelope, dict):
        return False, "invalid_signature"
    payload = envelope.get("payload")
    encoded_signature = envelope.get("signature")
    if (
        not isinstance(payload, dict)
        or not isinstance(encoded_signature, str)
        or len(encoded_signature) > 128
        or not isinstance(payload.get("subject"), dict)
    ):
        return False, "invalid_signature"
    try:
        signature = _b64url_decode(encoded_signature)
        if payload.get("checkpointVersion") != CHECKPOINT_VERSION:
            return False, "unsupported_checkpoint_version"
        if payload.get("alg") != "Ed25519":
            return False, "unsupported_algorithm"
        keys = key_registry.load_trusted_keys()
        if keys is None:
            # Backwards compatible single-key verifier; still requires the
            # original private key when no public registry is configured.
            if payload.get("issuerId") != settings.execution_proof_issuer_id:
                return False, "issuer_mismatch"
            if payload.get("keyId") != settings.execution_proof_signing_key_id:
                return False, "key_id_mismatch"
            public = _private_key().public_key()
            trusted_status = "active"
        else:
            issuer_id, key_id = payload.get("issuerId"), payload.get("keyId")
            if not isinstance(issuer_id, str) or not isinstance(key_id, str):
                return False, "untrusted_issuer_key"
            trusted = key_registry.resolve_trusted_key(
                keys, issuer_id=issuer_id, key_id=key_id,
            )
            if trusted is None:
                return False, "untrusted_issuer_key"
            public = trusted.public_key()
            trusted_status = trusted.status
        public.verify(signature, _canonical_bytes(payload))
        if trusted_status == "revoked":
            return False, "issuer_key_revoked"
        return True, None
    except ExecutionIssuerNotConfigured:
        raise
    except (KeyError, ValueError, TypeError, AttributeError, binascii.Error, InvalidSignature):
        return False, "invalid_signature"


async def revoke_checkpoint(
    db: AsyncSession,
    *,
    checkpoint_sha256: str,
    reason: str,
    revoked_by: str,
) -> dict[str, Any]:
    checkpoint_sha256 = str(checkpoint_sha256 or "").strip().lower()
    if len(checkpoint_sha256) != 64 or any(ch not in "0123456789abcdef" for ch in checkpoint_sha256):
        raise InvalidExecutionCheckpoint("checkpoint_sha256_invalid")
    reason = str(reason or "").strip()
    if len(reason) < 3 or len(reason) > 500:
        raise InvalidExecutionCheckpoint("revocation_reason_invalid")
    await db.execute(
        text(
            """INSERT INTO execution_proof_revocations(
                 checkpoint_sha256,reason,revoked_by,revoked_at
               ) VALUES(:sha,:reason,:revoked_by,CURRENT_TIMESTAMP)
               ON CONFLICT(checkpoint_sha256) DO NOTHING"""
        ),
        {"sha": checkpoint_sha256, "reason": reason, "revoked_by": revoked_by},
    )
    await db.commit()
    row = (
        await db.execute(
            text(
                """SELECT checkpoint_sha256,reason,revoked_by,revoked_at
                   FROM execution_proof_revocations
                   WHERE checkpoint_sha256=:sha"""
            ),
            {"sha": checkpoint_sha256},
        )
    ).mappings().first()
    return dict(row) if row else {"checkpoint_sha256": checkpoint_sha256}


async def verify_current_status(
    db: AsyncSession,
    *,
    envelope: dict[str, Any],
) -> dict[str, Any]:
    try:
        signature_valid, signature_error = verify_signature(envelope)
    except ExecutionIssuerNotConfigured:
        return {
            "status": "ISSUER_NOT_CONFIGURED",
            "signatureValid": False,
            "current": False,
            "revoked": False,
        }
    except key_registry.TrustKeyRegistryInvalid:
        return {
            "status": "TRUST_REGISTRY_INVALID",
            "signatureValid": False,
            "current": False,
            "revoked": False,
        }
    if signature_error == "issuer_key_revoked":
        return {
            "status": "ISSUER_KEY_REVOKED",
            "signatureValid": True,
            "current": False,
            "revoked": True,
        }
    if not signature_valid:
        return {
            "status": "INVALID_SIGNATURE",
            "signatureValid": False,
            "current": False,
            "revoked": False,
            "reason": signature_error,
        }

    expected_sha = hashlib.sha256(_canonical_bytes({
        "payload": envelope["payload"],
        "signature": envelope["signature"],
    })).hexdigest()
    supplied_sha = str(envelope.get("checkpointSha256") or "").lower()
    if supplied_sha != expected_sha:
        return {
            "status": "INVALID_ENVELOPE_HASH",
            "signatureValid": True,
            "current": False,
            "revoked": False,
        }

    revocation = (
        await db.execute(
            text(
                """SELECT reason,revoked_by,revoked_at
                   FROM execution_proof_revocations
                   WHERE checkpoint_sha256=:sha"""
            ),
            {"sha": supplied_sha},
        )
    ).mappings().first()
    if revocation:
        # This route is PUBLIC. Keep the revocation flag and timestamp, but
        # never disclose the admin user ID or free-text internal reason.
        revoked_at = revocation["revoked_at"]
        return {
            "status": "REVOKED",
            "signatureValid": True,
            "current": False,
            "revoked": True,
            "revocation": {
                "revokedAt": revoked_at.isoformat()
                if hasattr(revoked_at, "isoformat") else str(revoked_at),
            },
        }

    subject = envelope["payload"].get("subject") or {}
    try:
        current = await execution_records.get_portable_execution_proof(
            db,
            project_id=str(subject.get("projectId") or ""),
            stage_id=str(subject.get("stageId") or ""),
        )
    except (execution_records.ExecutionRecordNotAccepted, execution_records.ExecutionRecordStageNotFound):
        return {
            "status": "STALE",
            "signatureValid": True,
            "current": False,
            "revoked": False,
            "reason": "canonical_subject_no_longer_verifiable",
        }

    if current["proofHashSha256"] != envelope["payload"].get("proofHashSha256"):
        return {
            "status": "STALE",
            "signatureValid": True,
            "current": False,
            "revoked": False,
            "currentProofHashSha256": current["proofHashSha256"],
        }

    return {
        "status": "VALID",
        "signatureValid": True,
        "current": True,
        "revoked": False,
        "checkpointSha256": supplied_sha,
        "proofHashSha256": current["proofHashSha256"],
    }
