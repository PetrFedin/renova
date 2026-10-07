import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.config import settings
from app.services import execution_proof_trust_service as trust


def _key_b64():
    private = Ed25519PrivateKey.generate()
    raw = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def test_public_key_fails_closed_without_configured_private_key(monkeypatch):
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)
    with pytest.raises(trust.ExecutionIssuerNotConfigured):
        trust.public_key_document()


@pytest.mark.asyncio
async def test_checkpoint_signature_verifies_and_tampering_fails(monkeypatch):
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", _key_b64())
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "test-key-1")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")

    async def fake_proof(_db, *, project_id, stage_id):
        assert project_id == "project-1"
        assert stage_id == "stage-1"
        return {
            "proofHashSha256": "a" * 64,
            "sourceRecordHashSha256": "b" * 64,
            "evidence": {"level": "E2"},
            "acceptance": {"status": "accepted"},
        }

    monkeypatch.setattr(
        trust.execution_records,
        "get_portable_execution_proof",
        fake_proof,
    )

    envelope = await trust.issue_checkpoint(
        object(),
        project_id="project-1",
        stage_id="stage-1",
    )
    valid, error = trust.verify_signature(envelope)
    assert valid is True
    assert error is None
    assert envelope["payload"]["proofHashSha256"] == "a" * 64
    assert envelope["payload"]["sourceRecordHashSha256"] == "b" * 64
    assert len(envelope["checkpointSha256"]) == 64

    tampered = {
        **envelope,
        "payload": {
            **envelope["payload"],
            "proofHashSha256": "c" * 64,
        },
    }
    valid, error = trust.verify_signature(tampered)
    assert valid is False
    assert error == "invalid_signature"


def test_public_key_document_exposes_public_material_only(monkeypatch):
    private_b64 = _key_b64()
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", private_b64)
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "test-key-2")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")

    doc = trust.public_key_document()
    assert doc["alg"] == "Ed25519"
    assert doc["keyId"] == "test-key-2"
    assert doc["publicKeyMultibase"].startswith("u")
    assert private_b64 not in str(doc)
