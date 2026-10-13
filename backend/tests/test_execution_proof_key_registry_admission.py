"""Negative admission and rotation evidence for the PUBLIC execution keyring.

Private test keys are ephemeral and never stored or sent to an external provider.
Verification must not depend on a previously retired private signing key.
"""
import base64
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import app
from app.models.execution_proof_trust import ExecutionProofRevocation  # noqa: F401
from app.services import execution_proof_key_registry as registry
from app.services import execution_proof_trust_service as trust


def signing_secret():
    key = Ed25519PrivateKey.generate()
    raw = key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def entry(secret: str, key_id: str, status: str = "active", issuer="renova-test"):
    raw = base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
    public = Ed25519PrivateKey.from_private_bytes(raw).public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw,
    )
    return {
        "issuerId": issuer,
        "keyId": key_id,
        "alg": "Ed25519",
        "status": status,
        "publicKeyMultibase": "u" + base64.urlsafe_b64encode(public).decode("ascii").rstrip("="),
    }


async def old_issued_envelope(db, monkeypatch, old_secret):
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", old_secret)
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "old-key")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")

    async def fake_proof(_db, *, project_id, stage_id):
        assert (project_id, stage_id) == ("project", "stage")
        return {
            "proofHashSha256": "a" * 64,
            "sourceRecordHashSha256": "b" * 64,
            "evidence": {"level": "E2"},
            "acceptance": {"status": "accepted"},
        }

    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", fake_proof)
    return await trust.issue_checkpoint(db, project_id="project", stage_id="stage")


@pytest.mark.asyncio
async def test_retired_public_key_verifies_checkpoint_after_private_key_rotation(db, monkeypatch):
    old, new = signing_secret(), signing_secret()
    checkpoint = await old_issued_envelope(db, monkeypatch, old)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        entry(old, "old-key", "retired"), entry(new, "new-key", "active"),
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "new-key")

    assert trust.verify_signature(checkpoint) == (True, None)
    verified = await trust.verify_current_status(db, envelope=checkpoint)
    assert verified["status"] == "VALID", verified
    assert verified["current"] is True

    public_keys = trust.public_keys_document()
    assert [row["status"] for row in public_keys["keys"]] == ["retired", "active"]
    assert old not in str(public_keys)
    assert new not in str(public_keys)


@pytest.mark.asyncio
async def test_revoked_key_is_distinct_from_checkpoint_revocation(db, monkeypatch):
    old = signing_secret()
    checkpoint = await old_issued_envelope(db, monkeypatch, old)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        entry(old, "old-key", "revoked"),
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    status = await trust.verify_current_status(db, envelope=checkpoint)
    assert status["status"] == "ISSUER_KEY_REVOKED"
    assert status["signatureValid"] is True
    assert status["current"] is False
    assert status["revoked"] is True


@pytest.mark.asyncio
async def test_unknown_key_cannot_fall_back_to_retained_private_key(db, monkeypatch):
    old, new = signing_secret(), signing_secret()
    envelope = await old_issued_envelope(db, monkeypatch, old)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        entry(new, "new-key", "active"),
    ]))
    # Even with the old private key still on this process, explicit trust
    # configuration MUST be authoritative.
    assert trust.verify_signature(envelope) == (False, "untrusted_issuer_key")


def test_nonactive_or_mismatched_signing_key_cannot_issue(monkeypatch):
    old, other = signing_secret(), signing_secret()
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", old)
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "old-key")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")

    for registry_rows in (
        [entry(old, "old-key", "retired")],
        [entry(other, "old-key", "active")],
        [entry(old, "old-key", "revoked")],
    ):
        monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps(registry_rows))
        with pytest.raises(trust.ExecutionIssuerNotConfigured):
            trust.public_key_document()


@pytest.mark.parametrize("invalid", ["", " ", "{", "[]", '{}', '[{}]'])
def test_explicit_invalid_registry_never_enables_legacy_fallback(monkeypatch, invalid):
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", invalid)
    with pytest.raises(registry.TrustKeyRegistryInvalid):
        registry.load_trusted_keys()


def test_duplicate_identity_and_wrong_public_encoding_rejected(monkeypatch):
    old, other = signing_secret(), signing_secret()
    duplicates = [entry(old, "same"), entry(other, "same", "retired")]
    for rows in (
        duplicates,
        [{**entry(old, "one"), "publicKeyMultibase": "u" + "!" * 43}],
        [{**entry(old, "one"), "extraUnexpectedField": True}],
    ):
        monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps(rows))
        with pytest.raises(registry.TrustKeyRegistryInvalid):
            registry.load_trusted_keys()


@pytest.mark.asyncio
async def test_public_keys_endpoint_never_requires_or_returns_private_key(monkeypatch):
    old, new = signing_secret(), signing_secret()
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        entry(old, "old-key", "retired"), entry(new, "new-key", "active"),
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/execution-trust/public-keys")
        assert response.status_code == 200, response.text
        document = response.json()
        assert len(document["keys"]) == 2
        assert [x["status"] for x in document["keys"]] == ["retired", "active"]
        assert old not in response.text and new not in response.text
        assert "execution_proof_signing_private_key_b64" not in response.text

        monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", "{}")
        bad = await client.get("/api/v1/execution-trust/public-keys")
        assert bad.status_code == 503, bad.text
        assert bad.json()["detail"]["code"] == registry.TrustKeyRegistryInvalid.code
