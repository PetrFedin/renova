"""Operator-controlled, public-key-only trust registry for execution checkpoints.

The registry is a configuration snapshot, not a mutable public API. It never
accepts caller-supplied keys and never contains private signing material.
Unset configuration retains the legacy single-key verifier; malformed explicitly
configured registries fail closed instead of falling back to the current key.
"""
from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.core.config import settings

_KEY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_PUBLIC_KEY = re.compile(r"^u[A-Za-z0-9_-]{43}$")
_ALLOWED_STATUS = frozenset({"active", "retired", "revoked"})
_ALLOWED_FIELDS = frozenset({"issuerId", "keyId", "alg", "status", "publicKeyMultibase"})
_MAX_REGISTRY_BYTES = 16384
_MAX_KEYS = 32


class TrustKeyRegistryInvalid(RuntimeError):
    code = "execution_proof_key_registry_invalid"


@dataclass(frozen=True)
class TrustedProofKey:
    issuer_id: str
    key_id: str
    status: str
    public_key_b64: str
    public_key_bytes: bytes

    def public_document(self) -> dict[str, str]:
        return {
            "issuerId": self.issuer_id,
            "keyId": self.key_id,
            "alg": "Ed25519",
            "status": self.status,
            "publicKeyMultibase": "u" + self.public_key_b64,
        }

    def public_key(self) -> Ed25519PublicKey:
        return Ed25519PublicKey.from_public_bytes(self.public_key_bytes)


def load_trusted_keys() -> tuple[TrustedProofKey, ...] | None:
    """None means *no registry configured* (legacy compatibility).

    [] or malformed/noncanonical JSON means an invalid registry, never fallback.
    The operator must review each imported key out-of-band. This code does not
    establish origin or trust in any key by merely seeing it in a user request.
    """
    source = settings.execution_proof_trusted_public_keys_json
    if source is None:
        return None
    if not isinstance(source, str) or not 0 < len(source.encode("utf-8")) <= _MAX_REGISTRY_BYTES:
        raise TrustKeyRegistryInvalid("registry_size_invalid")
    try:
        rows = json.loads(source)
    except (TypeError, ValueError) as exc:
        raise TrustKeyRegistryInvalid("registry_json_invalid") from exc
    if not isinstance(rows, list) or not 1 <= len(rows) <= _MAX_KEYS:
        raise TrustKeyRegistryInvalid("registry_records_invalid")
    keys: list[TrustedProofKey] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != _ALLOWED_FIELDS:
            raise TrustKeyRegistryInvalid("registry_fields_invalid")
        issuer_id, key_id = row["issuerId"], row["keyId"]
        status, alg, public_value = row["status"], row["alg"], row["publicKeyMultibase"]
        if (
            not isinstance(issuer_id, str)
            or not _KEY_ID.fullmatch(issuer_id)
            or not isinstance(key_id, str)
            or not _KEY_ID.fullmatch(key_id)
            or not isinstance(status, str)
            or status not in _ALLOWED_STATUS
            or alg != "Ed25519"
            or not isinstance(public_value, str)
            or not _PUBLIC_KEY.fullmatch(public_value)
        ):
            raise TrustKeyRegistryInvalid("registry_key_invalid")
        pair = (issuer_id, key_id)
        if pair in seen:
            raise TrustKeyRegistryInvalid("registry_duplicate_key_id")
        seen.add(pair)
        encoded = public_value[1:]
        try:
            decoded = base64.urlsafe_b64decode(encoded + "=")
        except (ValueError, binascii.Error) as exc:
            raise TrustKeyRegistryInvalid("registry_public_key_invalid") from exc
        if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != encoded:
            raise TrustKeyRegistryInvalid("registry_public_key_not_canonical")
        keys.append(TrustedProofKey(issuer_id, key_id, status, encoded, decoded))
    return tuple(keys)


def resolve_trusted_key(
    keys: tuple[TrustedProofKey, ...], *, issuer_id: str, key_id: str
) -> TrustedProofKey | None:
    return next((key for key in keys if key.issuer_id == issuer_id and key.key_id == key_id), None)
