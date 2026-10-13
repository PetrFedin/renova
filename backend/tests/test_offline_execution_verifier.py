"""Offline verifier regression: cryptographic math is not current trust."""
import base64
import hashlib
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from app.services.offline_execution_verifier import _canonical, verify_offline, VERSION


def _signed():
    secret = Ed25519PrivateKey.generate()
    raw = secret.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    key = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    payload = {
        "checkpointVersion": VERSION, "alg": "Ed25519", "issuerId": "renova-platform",
        "keyId": "k1", "subject": {"projectId": "project-1", "stageId": "stage-1"},
        "issuedAt": "2026-10-13T00:00:00+00:00", "proofHashSha256": "a" * 64,
    }
    sig = base64.urlsafe_b64encode(secret.sign(_canonical(payload))).decode().rstrip("=")
    envelope = {"payload": payload, "signature": sig}
    envelope["checkpointSha256"] = hashlib.sha256(_canonical(envelope)).hexdigest()
    return envelope, {
        "issuerId": "renova-platform", "keyId": "k1", "alg": "Ed25519",
        "status": "active", "publicKeyMultibase": "u" + key,
    }


def test_active_offline_signature_never_claims_live_verification():
    envelope, key = _signed()
    result = verify_offline(envelope, key)
    assert result["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    assert result["cryptographicSignatureValid"] is True
    assert result["checkpointHashValid"] is True
    assert result["onlineStateChecked"] is False
    assert result["revocationCurrent"] is None
    assert result["canonicalProofCurrent"] is None
    assert result["issuanceTimeIndependentlyVerified"] is False
    assert result["keyCustodyVerified"] is False


def test_retired_signature_is_mathematically_verifiable_without_currentness_claim():
    envelope, key = _signed()
    key["status"] = "retired"
    result = verify_offline(envelope, key)
    assert result["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    assert result["keyStatus"] == "retired"
    assert result["canonicalProofCurrent"] is None


def test_revoked_key_does_not_count_as_trusted_signature():
    envelope, key = _signed()
    key["status"] = "revoked"
    result = verify_offline(envelope, key)
    assert result["status"] == "REVOKED_KEY"
    assert result["cryptographicSignatureValid"]
    assert result["canonicalProofCurrent"] is None


def test_tampered_subject_is_rejected():
    envelope, key = _signed()
    envelope["payload"]["subject"]["stageId"] = "other"
    assert verify_offline(envelope, key)["status"] == "INVALID_SIGNATURE"


def test_checkpoint_hash_mismatch_is_rejected():
    envelope, key = _signed()
    envelope["checkpointSha256"] = "f" * 64
    assert verify_offline(envelope, key)["status"] == "INVALID_CHECKPOINT_HASH"


def test_wrong_pinned_key_identity_rejected():
    envelope, key = _signed()
    key["keyId"] = "different"
    assert verify_offline(envelope, key)["status"] == "UNTRUSTED_KEY"


def test_untrusted_public_bytes_rejected():
    envelope, key = _signed()
    _, different = _signed()
    key["publicKeyMultibase"] = different["publicKeyMultibase"]
    assert verify_offline(envelope, key)["status"] == "INVALID_SIGNATURE"


@pytest.mark.parametrize("malformed", [None, {}, {"payload": []}, {"payload": {"subject": []}}, {"payload": {}, "signature": "🔥"}])
def test_malformed_input_does_not_crash(malformed):
    _, key = _signed()
    assert verify_offline(malformed, key)["status"] == "MALFORMED_INPUT"


def test_unsupported_algorithm():
    envelope, key = _signed()
    envelope["payload"]["alg"] = "none"
    assert verify_offline(envelope, key)["status"] == "UNSUPPORTED_FORMAT"


def test_envelope_can_never_supply_its_own_trust_key():
    envelope, key = _signed()
    envelope["publicKeyMultibase"] = key["publicKeyMultibase"]
    assert verify_offline(envelope, {})["status"] == "UNTRUSTED_KEY"
