import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.config import settings
from app.models.execution_proof_trust import ExecutionProofRevocation  # noqa: F401 - SQLite test mapping
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


@pytest.mark.parametrize("malformed", [
    {"payload": [], "signature": "not-base64"},
    {"payload": "object-not-provided", "signature": "any"},
    {"payload": {}, "signature": []},
    {"payload": {"subject": []}, "signature": "a" * 86},
    {"payload": {"subject": {}}, "signature": "a" * 4096},
    {"payload": {"subject": {}}, "signature": "🔒"},
    {},
])
def test_public_signature_verifier_rejects_malformed_envelopes_without_crashing(monkeypatch, malformed):
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", _key_b64())
    valid, error = trust.verify_signature(malformed)
    assert valid is False
    assert error is not None


@pytest.mark.asyncio
async def test_public_revocation_status_redacts_actor_and_internal_reason(db, monkeypatch):
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", _key_b64())
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "redaction-test-key")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-test")

    async def fake_proof(_db, *, project_id, stage_id):
        assert (project_id, stage_id) == ("project-one", "stage-one")
        return {
            "proofHashSha256": "a" * 64,
            "sourceRecordHashSha256": "b" * 64,
            "evidence": {"level": "E2"},
            "acceptance": {"status": "accepted"},
        }

    monkeypatch.setattr(trust.execution_records, "get_portable_execution_proof", fake_proof)
    envelope = await trust.issue_checkpoint(
        db, project_id="project-one", stage_id="stage-one",
    )
    await trust.revoke_checkpoint(
        db,
        checkpoint_sha256=envelope["checkpointSha256"],
        reason="Secret security investigation for a named customer",
        revoked_by="internal-admin-private-123",
    )

    result = await trust.verify_current_status(db, envelope=envelope)
    assert result["status"] == "REVOKED"
    assert result["revoked"] is True
    assert result["signatureValid"] is True
    assert "revokedAt" in result["revocation"]
    assert "reason" not in result["revocation"]
    assert "revoked_by" not in result["revocation"]
    assert "internal-admin-private-123" not in str(result)
    assert "Secret security investigation" not in str(result)
