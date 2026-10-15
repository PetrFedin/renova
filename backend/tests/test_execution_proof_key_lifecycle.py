import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.execution_proof_key_lifecycle import LIFECYCLE_VERSION, verify_key_lifecycle


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def key_doc(issuer, key_id, private):
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"issuerId": issuer, "keyId": key_id, "alg": "Ed25519", "status": "active", "publicKeyMultibase": "u" + b64(public)}


def signed_event(payload, signers):
    signatures = {kid: {"alg": "Ed25519", "signature": b64(priv.sign(canonical(payload)))} for kid, priv in signers.items()}
    event = {"payload": payload, "signatures": signatures}
    event["eventSha256"] = hashlib.sha256(canonical(event)).hexdigest()
    return event


def fixture_bundle():
    issuer = "renova-platform"
    k1, k2 = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    root = key_doc(issuer, "k1", k1)
    p0 = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 0, "issuerId": issuer, "eventType": "GENESIS", "keyId": "k1", "publicKeyMultibase": root["publicKeyMultibase"], "claimedAt": "2026-10-15T10:00:00Z", "previousEventSha256": None}
    e0 = signed_event(p0, {"k1": k1})
    p1 = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 1, "issuerId": issuer, "eventType": "ROTATE", "oldKeyId": "k1", "newKeyId": "k2", "newPublicKeyMultibase": key_doc(issuer, "k2", k2)["publicKeyMultibase"], "claimedAt": "2026-10-15T11:00:00Z", "previousEventSha256": e0["eventSha256"]}
    e1 = signed_event(p1, {"k1": k1, "k2": k2})
    p2 = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 2, "issuerId": issuer, "eventType": "REVOKE", "targetKeyId": "k1", "claimedAt": "2026-10-15T12:00:00Z", "previousEventSha256": e1["eventSha256"]}
    e2 = signed_event(p2, {"k2": k2})
    bundle = {"lifecycleVersion": LIFECYCLE_VERSION, "issuerId": issuer, "events": [e0, e1, e2]}
    pin = hashlib.sha256(canonical(root)).hexdigest()
    return bundle, root, pin, k1, k2


def verify(bundle=None, root=None, pin=None):
    b, r, p, *_ = fixture_bundle()
    return verify_key_lifecycle(bundle if bundle is not None else b, root if root is not None else r, pinned_root_key_sha256=pin if pin is not None else p)


def test_valid_rotation_and_retired_key_revocation():
    out = verify()
    assert out["status"] == "LIFECYCLE_VERIFIED"
    assert out["lifecycleValid"] is True
    assert out["activeKeyId"] == "k2"
    assert out["keyStates"] == {"k1": "revoked", "k2": "active"}
    assert out["externalTimeVerified"] is False
    assert out["releaseAuthorized"] is False


def test_wrong_root_pin_fails_before_chain():
    b, r, _, *_ = fixture_bundle()
    out = verify_key_lifecycle(b, r, pinned_root_key_sha256="0" * 64)
    assert out["status"] == "ROOT_PIN_MISMATCH"
    assert out["rootPinMatched"] is False


def test_root_extra_unsigned_field_rejected():
    b, r, p, *_ = fixture_bundle()
    r["bankApproved"] = True
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROOT_KEY_INVALID"


def test_event_extra_unsigned_field_rejected():
    b, r, p, *_ = fixture_bundle()
    b["events"][1]["bankApproved"] = True
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "MALFORMED_EVENT"


def test_payload_extra_unsigned_field_rejected():
    b, r, p, *_ = fixture_bundle()
    b["events"][1]["payload"]["trustedTimestamp"] = True
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "MALFORMED_EVENT"


def test_tampered_event_hash_rejected():
    b, r, p, *_ = fixture_bundle()
    b["events"][2]["eventSha256"] = "0" * 64
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "EVENT_HASH_INVALID"


def test_broken_previous_hash_rejected_even_if_event_rehashed():
    b, r, p, *_ = fixture_bundle()
    e = b["events"][2]
    e["payload"]["previousEventSha256"] = "1" * 64
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "CHAIN_PREVIOUS_HASH_MISMATCH"


def test_rotation_requires_old_and_new_proof_of_possession():
    b, r, p, *_ = fixture_bundle()
    e = b["events"][1]
    del e["signatures"]["k2"]
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_TRANSITION_INVALID"


def test_rotation_rejects_invalid_old_signature():
    b, r, p, *_ = fixture_bundle()
    e = b["events"][1]
    e["signatures"]["k1"]["signature"] = "A" * 86
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_OLD_KEY_SIGNATURE_INVALID"


def test_rotation_rejects_invalid_new_signature():
    b, r, p, *_ = fixture_bundle()
    e = b["events"][1]
    e["signatures"]["k2"]["signature"] = "A" * 86
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_NEW_KEY_SIGNATURE_INVALID"


def test_rotation_cannot_reuse_existing_key_id():
    b, r, p, k1, _ = fixture_bundle()
    e = b["events"][1]
    e["payload"]["newKeyId"] = "k1"
    e["signatures"] = {"k1": {"alg": "Ed25519", "signature": b64(k1.sign(canonical(e["payload"])))}}
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_TRANSITION_INVALID"


def test_rotation_cannot_relabel_same_public_key():
    b, r, p, k1, _ = fixture_bundle()
    e = b["events"][1]
    e["payload"]["newPublicKeyMultibase"] = r["publicKeyMultibase"]
    e["signatures"] = {
        "k1": {"alg": "Ed25519", "signature": b64(k1.sign(canonical(e["payload"])))},
        "k2": {"alg": "Ed25519", "signature": b64(k1.sign(canonical(e["payload"])))},
    }
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_TRANSITION_INVALID"


def test_revocation_must_be_signed_by_current_active_key():
    b, r, p, k1, _ = fixture_bundle()
    e = b["events"][2]
    e["signatures"] = {"k1": {"alg": "Ed25519", "signature": b64(k1.sign(canonical(e["payload"])))}}
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "REVOCATION_TRANSITION_INVALID"


def test_duplicate_revocation_rejected():
    b, r, p, _, k2 = fixture_bundle()
    prior = b["events"][-1]["eventSha256"]
    payload = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 3, "issuerId": "renova-platform", "eventType": "REVOKE", "targetKeyId": "k1", "claimedAt": "2026-10-15T13:00:00Z", "previousEventSha256": prior}
    b["events"].append(signed_event(payload, {"k2": k2}))
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "REVOCATION_TRANSITION_INVALID"


def test_reversing_claimed_time_fails_but_does_not_claim_trusted_time():
    b, r, p, _, k2 = fixture_bundle()
    e = b["events"][2]
    e["payload"]["claimedAt"] = "2026-10-15T10:30:00Z"
    e["signatures"] = {"k2": {"alg": "Ed25519", "signature": b64(k2.sign(canonical(e["payload"])))}}
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    out = verify_key_lifecycle(b, r, pinned_root_key_sha256=p)
    assert out["status"] == "CLAIMED_CHRONOLOGY_REVERSED"
    assert out["claimedChronologyConsistent"] is False
    assert out["externalTimeVerified"] is False


@pytest.mark.parametrize("claimed", ["2026-10-15 12:00:00Z", "2026-10-15T12:00:00+03:00", "not-time"])
def test_noncanonical_or_non_utc_claimed_time_rejected(claimed):
    b, r, p, _, k2 = fixture_bundle()
    e = b["events"][2]
    e["payload"]["claimedAt"] = claimed
    e["signatures"] = {"k2": {"alg": "Ed25519", "signature": b64(k2.sign(canonical(e["payload"])))}}
    e["eventSha256"] = hashlib.sha256(canonical({"payload": e["payload"], "signatures": e["signatures"]})).hexdigest()
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "CLAIMED_TIME_INVALID"


def test_emergency_revocation_of_active_key_leaves_no_active_key():
    b, r, p, _, k2 = fixture_bundle()
    b["events"] = b["events"][:2]
    prior = b["events"][-1]["eventSha256"]
    payload = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 2, "issuerId": "renova-platform", "eventType": "REVOKE", "targetKeyId": "k2", "claimedAt": "2026-10-15T12:00:00Z", "previousEventSha256": prior}
    b["events"].append(signed_event(payload, {"k2": k2}))
    out = verify_key_lifecycle(b, r, pinned_root_key_sha256=p)
    assert out["status"] == "LIFECYCLE_VERIFIED"
    assert out["activeKeyId"] is None
    assert out["keyStates"]["k2"] == "revoked"


def test_no_rotation_possible_after_emergency_active_revocation():
    b, r, p, _, k2 = fixture_bundle()
    b["events"] = b["events"][:2]
    prior = b["events"][-1]["eventSha256"]
    revoke = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 2, "issuerId": "renova-platform", "eventType": "REVOKE", "targetKeyId": "k2", "claimedAt": "2026-10-15T12:00:00Z", "previousEventSha256": prior}
    er = signed_event(revoke, {"k2": k2})
    b["events"].append(er)
    k3 = Ed25519PrivateKey.generate()
    rotate = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 3, "issuerId": "renova-platform", "eventType": "ROTATE", "oldKeyId": "k2", "newKeyId": "k3", "newPublicKeyMultibase": key_doc("renova-platform", "k3", k3)["publicKeyMultibase"], "claimedAt": "2026-10-15T13:00:00Z", "previousEventSha256": er["eventSha256"]}
    b["events"].append(signed_event(rotate, {"k2": k2, "k3": k3}))
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "ROTATION_TRANSITION_INVALID"


def test_sequence_gap_rejected():
    b, r, p, *_ = fixture_bundle()
    b["events"][2]["payload"]["sequence"] = 4
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "EVENT_IDENTITY_MISMATCH"


def test_issuer_mismatch_rejected():
    b, r, p, *_ = fixture_bundle()
    b["issuerId"] = "other"
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "MALFORMED_LIFECYCLE"


def test_empty_bundle_rejected():
    b, r, p, *_ = fixture_bundle()
    b["events"] = []
    assert verify_key_lifecycle(b, r, pinned_root_key_sha256=p)["status"] == "MALFORMED_LIFECYCLE"
