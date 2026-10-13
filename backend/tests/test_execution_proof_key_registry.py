"""Negative and rotation tests for operator-controlled execution-proof trust keys."""
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


def _pair():
    private = Ed25519PrivateKey.generate()
    secret = base64.urlsafe_b64encode(
        private.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode("ascii").rstrip("=")
    public = base64.urlsafe_b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode("ascii").rstrip("=")
    return secret, public


def _entry(key_id, public, status):
    return {
        "issuerId": "renova-test",
        "keyId": key_id,
        "alg": "Ed25519",
        "status": status,
        "publicKeyMultibase": "u" + public,
    }


async def _proof(_db, *, project_id, stage_id):
    assert project_id == "project-rotated"
    assert stage_id == "stage-rotated"
    return {
        "proofHashSha256": "a" * 64,
        "sourceRecordHashSha256": "b" * 64,
        "evidence": {"level": "E2"},
        "acceptance": {"status": "accepted"},
    }


@pytest.mark.asyncio
async def test_retired_key_remains_verifiable_after_rotation_without_old_private_key(db, monkeypatch):
    a_secret, a_public = _pair()
    b_secret, b_public = _pair()
    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", _proof)
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-a")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", a_secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)

    previous = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")
    assert trust.verify_signature(previous) == (True, None)

    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("key-a", a_public, "retired"), _entry("key-b", b_public, "active"),
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-b")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", b_secret)
    assert trust.verify_signature(previous) == (True, None)

    current = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")
    assert current["payload"]["keyId"] == "key-b"
    assert trust.verify_signature(current) == (True, None)
    registry_doc = trust.public_keys_document()
    assert [key["status"] for key in registry_doc["keys"]] == ["retired", "active"]
    assert trust.public_key_document()["keyId"] == "key-b"
    assert a_secret not in str(registry_doc) and b_secret not in str(registry_doc)

    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    # Verification is based on PUBLIC registry records, not a retired secret.
    assert trust.verify_signature(previous) == (True, None)
    assert trust.verify_signature(current) == (True, None)
    assert (await trust.verify_current_status(db, envelope=previous))["status"] == "VALID"
    with pytest.raises(trust.ExecutionIssuerNotConfigured):
        await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")


@pytest.mark.asyncio
async def test_revoked_issuer_key_never_counts_as_current(db, monkeypatch):
    a_secret, a_public = _pair()
    b_secret, b_public = _pair()
    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", _proof)
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-a")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", a_secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)
    previous = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")

    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-b")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", b_secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("key-a", a_public, "revoked"), _entry("key-b", b_public, "active"),
    ]))
    assert trust.verify_signature(previous) == (False, "issuer_key_revoked")
    status = await trust.verify_current_status(db, envelope=previous)
    assert status["status"] == "ISSUER_KEY_REVOKED"
    assert status["signatureValid"] is True
    assert status["current"] is False
    assert status["revoked"] is True

    tampered = {
        **previous,
        "payload": {**previous["payload"], "proofHashSha256": "f" * 64},
    }
    assert trust.verify_signature(tampered) == (False, "invalid_signature")
    assert (await trust.verify_current_status(db, envelope=tampered))["status"] == "INVALID_SIGNATURE"


@pytest.mark.parametrize("corrupt", [
    "[]",
    "{not json}",
    "null",
    '["untrusted"]',
    "x" * 17000,
    json.dumps([{"keyId": "no-more-data"}]),
])
def test_explicit_invalid_registry_never_falls_back(monkeypatch, corrupt):
    secret, _ = _pair()
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", corrupt)
    with pytest.raises(registry.TrustKeyRegistryInvalid):
        registry.load_trusted_keys()
    with pytest.raises(registry.TrustKeyRegistryInvalid):
        trust.public_key_document()


def test_key_registry_rejects_duplicate_noncanonical_and_revoked_issuance(monkeypatch):
    secret_a, pub_a = _pair()
    secret_b, pub_b = _pair()
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-b")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", secret_b)
    bad_registries = [
        [_entry("key-a", pub_a, "active"), _entry("key-a", pub_b, "retired")],
        [_entry("key-a", "not-a-32-byte-ed25519-key", "active")],
        [_entry("key-a", pub_a, "unknown")],
        [{**_entry("key-a", pub_a, "active"), "privateKey": secret_a}],
    ]
    for entries in bad_registries:
        monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps(entries))
        with pytest.raises(registry.TrustKeyRegistryInvalid):
            registry.load_trusted_keys()

    # An operator cannot declare unrelated key B as active while signing with A.
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("key-b", pub_b, "active")
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", secret_a)
    with pytest.raises(trust.ExecutionIssuerNotConfigured):
        trust.public_key_document()

    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", secret_b)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("key-b", pub_b, "retired")
    ]))
    with pytest.raises(trust.ExecutionIssuerNotConfigured):
        trust.public_key_document()


@pytest.mark.asyncio
async def test_public_key_registry_endpoint_does_not_require_private_signing_key(monkeypatch):
    _, a_public = _pair()
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("previous", a_public, "retired"),
    ]))
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/execution-trust/public-keys")
        assert response.status_code == 200, response.text
        keys = response.json()["keys"]
        assert len(keys) == 1
        assert keys[0]["status"] == "retired"
        assert "privateKey" not in str(response.json())
        active = await client.get("/api/v1/execution-trust/public-key")
        assert active.status_code == 503


@pytest.mark.asyncio
async def test_public_verifier_rejects_invalid_registry_without_server_error(db, monkeypatch):
    private, _ = _pair()
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "key-a")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", private)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)
    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", _proof)
    checkpoint = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")

    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", "invalid-json")
    response = await trust.verify_current_status(db, envelope=checkpoint)
    assert response == {
        "status": "TRUST_REGISTRY_INVALID",
        "signatureValid": False,
        "current": False,
        "revoked": False,
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        registry_response = await client.get("/api/v1/execution-trust/public-keys")
        assert registry_response.status_code == 503
        assert registry_response.json()["detail"]["code"] == "execution_proof_key_registry_invalid"


@pytest.mark.asyncio
async def test_unknown_registry_key_never_falls_back_to_retained_private_signer(db, monkeypatch):
    original_secret, original_public = _pair()
    other_secret, other_public = _pair()
    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", _proof)
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "legacy-key")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", original_secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)
    envelope = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")

    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("other-key", other_public, "active"),
    ]))
    # The old private key deliberately remains in memory; it MUST NOT be a
    # verification fallback after an explicit operator public trust registry.
    assert trust.verify_signature(envelope) == (False, "untrusted_issuer_key")


@pytest.mark.asyncio
async def test_semantically_wrong_algorithm_rejected_even_with_valid_ed25519_signature(db, monkeypatch):
    secret, public = _pair()
    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", _proof)
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "signer")
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", secret)
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", json.dumps([
        _entry("signer", public, "active"),
    ]))
    envelope = await trust.issue_checkpoint(db, project_id="project-rotated", stage_id="stage-rotated")
    assert trust.verify_signature(envelope) == (True, None)

    # An issuer with the actual Ed25519 signing secret could otherwise sign
    # a payload falsely claiming another algorithm; the verifier must reject
    # the mismatch, not silently treat every algorithm as Ed25519.
    altered = {**envelope["payload"], "alg": "none"}
    raw = base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
    private = Ed25519PrivateKey.from_private_bytes(raw)
    sig = private.sign(trust._canonical_bytes(altered))
    candidate = {
        "payload": altered,
        "signature": base64.urlsafe_b64encode(sig).decode("ascii").rstrip("="),
    }
    assert trust.verify_signature(candidate) == (False, "unsupported_algorithm")
