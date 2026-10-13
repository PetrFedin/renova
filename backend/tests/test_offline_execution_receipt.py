import hashlib
import pytest
from app.services.offline_execution_receipt import build_offline_receipt, trust_anchor_fingerprint
from app.services.offline_execution_verifier import verify_offline
from test_offline_execution_verifier import _signed


def _run(envelope=None, key=None, pin=None):
    if envelope is None or key is None:
        envelope, key = _signed()
    if pin is None:
        pin = trust_anchor_fingerprint(key)
    return build_offline_receipt(envelope, key, pinned_trust_anchor_sha256=pin)


def test_verifiable_receipt_is_not_current_state_authorization():
    receipt = _run()
    assert receipt["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    assert receipt["offlineIntegrityPassed"] is True
    assert receipt["pinnedTrustAnchorMatched"] is True
    assert receipt["releaseAuthorized"] is False
    assert receipt["onlineStateChecked"] is False
    assert receipt["canonicalProofCurrent"] is None
    assert receipt["revocationCurrent"] is None
    assert receipt["keyCustodyVerified"] is False
    assert receipt["issuanceTimeIndependentlyVerified"] is False
    assert len(receipt["limitations"]) >= 4


def test_wrong_pin_never_runs_trustworthy_verification():
    envelope, key = _signed()
    receipt = _run(envelope, key, "0" * 64)
    assert receipt["status"] == "TRUST_PIN_MISMATCH"
    assert receipt["offlineIntegrityPassed"] is False
    assert receipt["releaseAuthorized"] is False


@pytest.mark.parametrize("pin", ["", "A" * 64, "123", None, 123, "0" * 63])
def test_missing_or_invalid_pin_fails_closed(pin):
    envelope, key = _signed()
    receipt = build_offline_receipt(envelope, key, pinned_trust_anchor_sha256=pin)
    assert receipt["status"] == "PIN_MISSING_OR_INVALID"
    assert not receipt["offlineIntegrityPassed"]


def test_retired_key_always_requires_fresh_separately_pinned_status():
    envelope, key = _signed()
    active_pin = trust_anchor_fingerprint(key)
    key["status"] = "retired"
    assert _run(envelope, key, active_pin)["status"] == "TRUST_PIN_MISMATCH"
    result = _run(envelope, key)
    assert result["offlineIntegrityPassed"] is True
    assert result["keyStatusAtLocalVerification"] == "retired"
    assert result["releaseAuthorized"] is False


def test_revoked_key_remains_rejected_even_if_properly_pinned():
    envelope, key = _signed()
    key["status"] = "revoked"
    receipt = _run(envelope, key)
    assert receipt["status"] == "REVOKED_KEY"
    assert receipt["pinnedTrustAnchorMatched"] is True
    assert receipt["offlineIntegrityPassed"] is False


def test_tampered_signed_payload_yields_negative_receipt():
    envelope, key = _signed()
    envelope["payload"]["subject"]["stageId"] = "wrong"
    receipt = _run(envelope, key)
    assert receipt["status"] == "INVALID_SIGNATURE"
    assert not receipt["offlineIntegrityPassed"]


def test_wrong_checkpoint_hash_rejected():
    envelope, key = _signed()
    envelope["checkpointSha256"] = "f" * 64
    receipt = _run(envelope, key)
    assert receipt["status"] == "INVALID_CHECKPOINT_HASH"
    assert receipt["releaseAuthorized"] is False


def test_untrusted_key_identity_not_laundered_from_envelope():
    envelope, key = _signed()
    envelope["publicKeyMultibase"] = key["publicKeyMultibase"]
    receipt = _run(envelope, key)
    assert receipt["status"] == "MALFORMED_INPUT"
    assert receipt["offlineIntegrityPassed"] is False
    assert receipt["releaseAuthorized"] is False
    assert _run(envelope, {})["offlineIntegrityPassed"] is False


def test_trust_anchor_hash_is_deterministic_and_status_sensitive():
    _, key = _signed()
    first = trust_anchor_fingerprint(key)
    assert first == trust_anchor_fingerprint(dict(reversed(list(key.items()))))
    key["status"] = "revoked"
    assert first != trust_anchor_fingerprint(key)


def test_unexpected_trust_anchor_fields_rejected():
    envelope, key = _signed()
    key["trustedByEnvelope"] = True
    assert _run(envelope, key, "0" * 64)["status"] == "TRUST_ANCHOR_INVALID"


def test_receipt_contains_no_secret_or_personal_user_metadata():
    receipt = _run()
    text = str(receipt)
    assert "privateKey" not in text
    assert "customerId" not in text
    assert "revoked_by" not in text
