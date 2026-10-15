import base64
import hashlib
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.execution_proof_key_lifecycle import LIFECYCLE_VERSION
from app.services.execution_proof_status_publication import STATUS_PUBLICATION_VERSION, verify_status_publication


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def key_doc(issuer, key_id, private):
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"issuerId": issuer, "keyId": key_id, "alg": "Ed25519", "status": "active", "publicKeyMultibase": "u" + b64(public)}


def event(payload, signers):
    sigs = {kid: {"alg": "Ed25519", "signature": b64(priv.sign(canonical(payload)))} for kid, priv in signers.items()}
    out = {"payload": payload, "signatures": sigs}
    out["eventSha256"] = hashlib.sha256(canonical(out)).hexdigest()
    return out


def lifecycle_fixture():
    issuer = "renova-platform"
    k1, k2 = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    root = key_doc(issuer, "k1", k1)
    p0 = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 0, "issuerId": issuer, "eventType": "GENESIS", "keyId": "k1", "publicKeyMultibase": root["publicKeyMultibase"], "claimedAt": "2026-10-15T10:00:00Z", "previousEventSha256": None}
    e0 = event(p0, {"k1": k1})
    p1 = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 1, "issuerId": issuer, "eventType": "ROTATE", "oldKeyId": "k1", "newKeyId": "k2", "newPublicKeyMultibase": key_doc(issuer, "k2", k2)["publicKeyMultibase"], "claimedAt": "2026-10-15T11:00:00Z", "previousEventSha256": e0["eventSha256"]}
    e1 = event(p1, {"k1": k1, "k2": k2})
    bundle = {"lifecycleVersion": LIFECYCLE_VERSION, "issuerId": issuer, "events": [e0, e1]}
    root_pin = hashlib.sha256(canonical(root)).hexdigest()
    states_hash = hashlib.sha256(canonical({"k1": "retired", "k2": "active"})).hexdigest()
    return bundle, root, root_pin, k2, states_hash


def publication(bundle, signer, states_hash, sequence=0, previous=None, claimed="2026-10-15T12:00:00Z"):
    payload = {
        "publicationVersion": STATUS_PUBLICATION_VERSION,
        "issuerId": "renova-platform",
        "publicationSequence": sequence,
        "claimedAt": claimed,
        "lifecycleLastEventSha256": bundle["events"][-1]["eventSha256"],
        "activeKeyId": "k2",
        "keyStatesSha256": states_hash,
        "previousPublicationSha256": previous,
    }
    sig = b64(signer.sign(canonical(payload)))
    out = {"payload": payload, "signature": sig}
    out["publicationSha256"] = hashlib.sha256(canonical(out)).hexdigest()
    return out


def test_genesis_publication_verifies_but_does_not_claim_live_currentness():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    out = verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)
    assert out["status"] == "STATUS_PUBLICATION_VERIFIED"
    assert out["publicationVerified"] is True
    assert out["rollbackProtectedByPin"] is False
    assert out["onlineStateChecked"] is False
    assert out["currentPublicationKnown"] is False
    assert out["externalTimeVerified"] is False
    assert out["releaseAuthorized"] is False


def test_next_publication_matches_retained_previous_pin():
    bundle, root, pin, k2, states = lifecycle_fixture()
    first = publication(bundle, k2, states)
    second = publication(bundle, k2, states, 1, first["publicationSha256"], "2026-10-15T13:00:00Z")
    out = verify_status_publication(second, bundle, root, pinned_root_key_sha256=pin, pinned_previous_publication_sha256=first["publicationSha256"])
    assert out["status"] == "STATUS_PUBLICATION_VERIFIED"
    assert out["rollbackPinMatched"] is True
    assert out["rollbackProtectedByPin"] is True


def test_old_snapshot_cannot_match_newer_retained_pin():
    bundle, root, pin, k2, states = lifecycle_fixture()
    first = publication(bundle, k2, states)
    second = publication(bundle, k2, states, 1, first["publicationSha256"], "2026-10-15T13:00:00Z")
    out = verify_status_publication(first, bundle, root, pinned_root_key_sha256=pin, pinned_previous_publication_sha256=second["publicationSha256"])
    assert out["status"] == "PUBLICATION_ROLLBACK_PIN_MISMATCH"


def test_wrong_previous_pin_fails():
    bundle, root, pin, k2, states = lifecycle_fixture()
    second = publication(bundle, k2, states, 1, "1" * 64)
    out = verify_status_publication(second, bundle, root, pinned_root_key_sha256=pin, pinned_previous_publication_sha256="2" * 64)
    assert out["status"] == "PUBLICATION_ROLLBACK_PIN_MISMATCH"


def test_sequence_zero_must_not_have_previous_hash():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states, 0, "1" * 64)
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_PREVIOUS_HASH_INVALID"


def test_nonzero_sequence_requires_previous_hash():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states, 1, None)
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_PREVIOUS_HASH_INVALID"


def test_publication_binds_exact_lifecycle_head():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["payload"]["lifecycleLastEventSha256"] = "0" * 64
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_IDENTITY_MISMATCH"


def test_publication_binds_exact_key_states():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["payload"]["keyStatesSha256"] = "0" * 64
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_KEY_STATES_MISMATCH"


def test_wrong_active_key_id_fails():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["payload"]["activeKeyId"] = "k1"
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_IDENTITY_MISMATCH"


def test_signature_tamper_fails():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["signature"] = "A" * 86
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_SIGNATURE_INVALID"


def test_hash_tamper_fails_after_valid_signature():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["publicationSha256"] = "0" * 64
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_HASH_INVALID"


def test_unsigned_extra_top_level_claim_rejected():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["bankApproved"] = True
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "MALFORMED_PUBLICATION"


def test_unsigned_extra_payload_claim_rejected():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    pub["payload"]["onlineCurrent"] = True
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "MALFORMED_PUBLICATION"


def test_non_utc_claimed_time_rejected():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states, claimed="2026-10-15T12:00:00+03:00")
    assert verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)["status"] == "PUBLICATION_IDENTITY_MISMATCH"


def test_invalid_lifecycle_blocks_publication_before_signature_claims():
    bundle, root, pin, k2, states = lifecycle_fixture()
    pub = publication(bundle, k2, states)
    bundle["events"][-1]["eventSha256"] = "0" * 64
    out = verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)
    assert out["status"] == "LIFECYCLE_NOT_VERIFIED"
    assert out["publicationSignatureValid"] is False


def test_emergency_revoked_lifecycle_without_active_key_blocks_publication():
    bundle, root, pin, k2, states = lifecycle_fixture()
    prior = bundle["events"][-1]["eventSha256"]
    payload = {"lifecycleVersion": LIFECYCLE_VERSION, "sequence": 2, "issuerId": "renova-platform", "eventType": "REVOKE", "targetKeyId": "k2", "claimedAt": "2026-10-15T12:00:00Z", "previousEventSha256": prior}
    bundle["events"].append(event(payload, {"k2": k2}))
    pub = publication(bundle, k2, hashlib.sha256(canonical({"k1": "retired", "k2": "revoked"})).hexdigest())
    out = verify_status_publication(pub, bundle, root, pinned_root_key_sha256=pin)
    assert out["status"] == "NO_ACTIVE_LIFECYCLE_KEY"
