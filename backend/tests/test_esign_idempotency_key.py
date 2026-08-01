from dataclasses import replace

from app.services.esign.base import SignRequest
from app.services.esign.kontur import _idempotency_id


def request() -> SignRequest:
    return SignRequest(
        document_id="document-1",
        version_id="version-1",
        signer_user_id="user-1",
        signer_role="customer",
        content_hash="a" * 64,
        title="Договор",
        mime_type="application/pdf",
    )


def test_same_signature_intent_has_one_provider_idempotency_identity():
    first = request()
    assert _idempotency_id(first) == _idempotency_id(first)
    assert _idempotency_id(first).startswith("renova-")
    assert len(_idempotency_id(first)) == len("renova-") + 48


def test_persisted_identity_overrides_recalculation_during_reconciliation():
    retried = replace(request(), idempotency_key="renova-durable-intent-123")
    assert _idempotency_id(retried) == "renova-durable-intent-123"


def test_material_signature_changes_create_distinct_idempotency_identity():
    base = request()
    variants = [
        replace(base, version_id="version-2"),
        replace(base, signer_user_id="user-2"),
        replace(base, signer_role="contractor"),
        replace(base, content_hash="b" * 64),
    ]

    identities = {_idempotency_id(base), *(_idempotency_id(item) for item in variants)}
    assert len(identities) == 1 + len(variants)
