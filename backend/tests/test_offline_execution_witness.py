"""Offline independent checkpoint witness regression tests (ephemeral keys only)."""
import base64
import hashlib
from copy import deepcopy

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.offline_execution_receipt import trust_anchor_fingerprint
from app.services.offline_execution_verifier import _canonical
from app.services.offline_execution_witness import (
    WITNESS_VERSION,
    verify_independent_witness,
)
from test_offline_execution_verifier import _signed


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _sign_witness(payload, signer):
    signature = _b64(signer.sign(_canonical(payload)))
    signed = {"payload": payload, "signature": signature}
    signed["receiptSha256"] = hashlib.sha256(_canonical(signed)).hexdigest()
    return signed


def _fixture():
    checkpoint, issuer_key = _signed()
    signer = Ed25519PrivateKey.generate()
    public = signer.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    key = {
        "issuerId": "independent-auditor-01",
        "keyId": "witness-key-v1",
        "alg": "Ed25519",
        "status": "active",
        "publicKeyMultibase": "u" + _b64(public),
    }
    payload = {
        "witnessVersion": WITNESS_VERSION,
        "alg": "Ed25519",
        "witnessId": key["issuerId"],
        "witnessKeyId": key["keyId"],
        "checkpointSha256": checkpoint["checkpointSha256"],
        "checkpointIssuerId": checkpoint["payload"]["issuerId"],
        "checkpointKeyId": checkpoint["payload"]["keyId"],
        "checkpointIssuedAt": checkpoint["payload"]["issuedAt"],
        "observedAt": "2026-10-13T00:05:00+00:00",
    }
    signed = _sign_witness(payload, signer)
    return checkpoint, issuer_key, signed, key, signer


def _verify(checkpoint, issuer_key, witness, witness_key, **overrides):
    return verify_independent_witness(
        checkpoint,
        issuer_key,
        witness,
        witness_key,
        pinned_checkpoint_key_sha256=overrides.get(
            "issuer_pin", trust_anchor_fingerprint(issuer_key)
        ),
        pinned_witness_key_sha256=overrides.get(
            "witness_pin", trust_anchor_fingerprint(witness_key)
        ),
    )


def test_valid_distinct_witness_signature_never_proves_wall_clock_or_current_state():
    cp, issuer, witness, key, _ = _fixture()
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_SIGNATURE_VERIFIED"
    assert result["checkpointIntegrityPassed"] is True
    assert result["checkpointHashBindingValid"] is True
    assert result["witnessReceiptHashValid"] is True
    assert result["witnessSignatureValid"] is True
    assert result["witnessChronologyConsistent"] is True
    assert result["offlineWitnessEvidencePassed"] is True
    assert result["independentWitnessTimeVerified"] is False
    assert result["witnessOrganizationalIndependenceVerified"] is False
    assert result["keyCustodyVerified"] is False
    assert result["canonicalProofCurrent"] is None
    assert result["revocationCurrent"] is None
    assert result["releaseAuthorized"] is False


def test_retired_distinct_witness_key_is_only_historically_cryptographic():
    cp, issuer, witness, key, _ = _fixture()
    key["status"] = "retired"
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_SIGNATURE_VERIFIED"
    assert result["witnessKeyStatusAtLocalVerification"] == "retired"
    assert result["independentWitnessTimeVerified"] is False
    assert result["releaseAuthorized"] is False


def test_revoked_distinct_witness_key_cannot_count_as_trusted():
    cp, issuer, witness, key, _ = _fixture()
    key["status"] = "revoked"
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_KEY_REVOKED"
    assert result["witnessSignatureValid"] is True
    assert result["offlineWitnessEvidencePassed"] is False


def test_wrong_independently_pinned_witness_key_denied():
    cp, issuer, witness, key, _ = _fixture()
    result = _verify(cp, issuer, witness, key, witness_pin="0" * 64)
    assert result["status"] == "WITNESS_TRUST_PIN_MISMATCH"
    assert result["witnessSignatureValid"] is False
    assert result["offlineWitnessEvidencePassed"] is False


@pytest.mark.parametrize("pin", ["", "f" * 63, "G" * 64, None])
def test_missing_or_malformed_witness_pin_denied(pin):
    cp, issuer, witness, key, _ = _fixture()
    result = _verify(cp, issuer, witness, key, witness_pin=pin)
    assert result["status"] == "WITNESS_PIN_MISSING_OR_INVALID"
    assert result["offlineWitnessEvidencePassed"] is False


def test_bad_checkpoint_trust_pin_blocks_witness_before_signature():
    cp, issuer, witness, key, _ = _fixture()
    result = _verify(cp, issuer, witness, key, issuer_pin="0" * 64)
    assert result["status"] == "CHECKPOINT_NOT_VERIFIED"
    assert result["checkpointStatus"] == "TRUST_PIN_MISMATCH"


def test_witness_same_public_key_disguised_with_another_identity_denied():
    cp, issuer, witness, key, _ = _fixture()
    key["publicKeyMultibase"] = issuer["publicKeyMultibase"]
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_KEY_NOT_DISTINCT"
    assert result["offlineWitnessEvidencePassed"] is False


def test_witness_reuses_platform_issuer_identity_denied():
    cp, issuer, witness, key, _ = _fixture()
    key["issuerId"] = issuer["issuerId"]
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_IDENTITY_NOT_DISTINCT"


def test_witness_payload_signature_tampering_denied():
    cp, issuer, witness, key, _ = _fixture()
    witness["payload"]["observedAt"] = "2026-10-14T00:00:00+00:00"
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_SIGNATURE_INVALID"
    assert result["witnessSignatureValid"] is False


def test_witness_receipt_sha256_tampering_denied():
    cp, issuer, witness, key, _ = _fixture()
    witness["receiptSha256"] = "f" * 64
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_RECEIPT_HASH_INVALID"
    assert result["witnessSignatureValid"] is True
    assert result["witnessReceiptHashValid"] is False


def test_witness_signature_for_another_checkpoint_not_transferable():
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({
        **witness["payload"],
        "checkpointSha256": "f" * 64,
    }, signer)
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_CHECKPOINT_MISMATCH"
    assert result["witnessSignatureValid"] is True
    assert result["checkpointHashBindingValid"] is False


def test_witness_issuer_id_must_equal_original_checkpoint():
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({
        **witness["payload"],
        "checkpointIssuerId": "not-renova",
    }, signer)
    assert _verify(cp, issuer, witness, key)["status"] == "WITNESS_CHECKPOINT_IDENTITY_MISMATCH"


def test_backdated_observation_claim_rejected_even_with_valid_signature():
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({
        **witness["payload"],
        "observedAt": "2026-10-12T23:59:59+00:00",
    }, signer)
    result = _verify(cp, issuer, witness, key)
    assert result["status"] == "WITNESS_CHRONOLOGY_INVALID"
    assert result["witnessChronologyConsistent"] is False
    assert result["independentWitnessTimeVerified"] is False


def test_mismatched_claimed_issuer_timestamp_rejected():
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({
        **witness["payload"],
        "checkpointIssuedAt": "2026-10-13T00:00:30+00:00",
    }, signer)
    assert _verify(cp, issuer, witness, key)["status"] == "WITNESS_CHRONOLOGY_INVALID"


@pytest.mark.parametrize("value", ["not-a-date", "2026-10-13T01:00:00+01:00", "2026-10-13", 3])
def test_malformed_or_non_utc_claimed_observation_rejected(value):
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({**witness["payload"], "observedAt": value}, signer)
    assert _verify(cp, issuer, witness, key)["status"] == "WITNESS_CHRONOLOGY_INVALID"


@pytest.mark.parametrize("field,value", [
    ("bankApproved", True),
    ("independentlyWitnessedTime", True),
    ("publicKeyMultibase", "unsigned-witness-key"),
])
def test_unsigned_witness_top_level_claims_rejected(field, value):
    cp, issuer, witness, key, _ = _fixture()
    witness[field] = value
    assert _verify(cp, issuer, witness, key)["status"] == "MALFORMED_WITNESS"


@pytest.mark.parametrize("field,value", [
    ("bankApproved", True),
    ("observedAt", "bogus"),
    ("witnessSignatureValid", True),
])
def test_extra_or_overwritten_witness_payload_not_signed(field, value):
    cp, issuer, witness, key, _ = _fixture()
    witness["payload"][field] = value
    assert _verify(cp, issuer, witness, key)["status"] == "MALFORMED_WITNESS"


def test_untrusted_witness_public_key_cannot_be_embedded_in_receipt():
    cp, issuer, witness, key, _ = _fixture()
    witness["trustedPublicKey"] = deepcopy(key)
    assert _verify(cp, issuer, witness, key)["status"] == "MALFORMED_WITNESS"


def test_signed_different_algorithm_rejected():
    cp, issuer, witness, key, signer = _fixture()
    witness = _sign_witness({**witness["payload"], "alg": "none"}, signer)
    assert _verify(cp, issuer, witness, key)["status"] == "UNSUPPORTED_WITNESS_FORMAT"
