"""Kontur webhook payload normalize + provider field alias."""
import pytest
from fastapi import HTTPException

from app.api.v1.esign import parse_esign_webhook_payload


def test_parse_renova_shape():
    ext, st = parse_esign_webhook_payload({"external_id": "kontur-sandbox-abc12345", "status": "signed"})
    assert ext.startswith("kontur")
    assert st == "signed"


def test_parse_kontur_like_object():
    ext, st = parse_esign_webhook_payload({"object": {"id": "ext-99999", "status": "completed"}})
    assert ext == "ext-99999"
    assert st == "signed"


def test_parse_requires_id():
    with pytest.raises(HTTPException):
        parse_esign_webhook_payload({"status": "signed"})


def test_document_dict_provider_alias():
    from types import SimpleNamespace
    from app.services.project_document_service import document_dict

    doc = SimpleNamespace(
        id="d1",
        document_type="contract",
        title="Dogovor",
        status="draft",
        created_at=None,
        project_id="p1",
        stage_id=None,
        payment_id=None,
        receipt_id=None,
        work_acceptance_id=None,
        current_version_id=None,
        notes=None,
        legal_hold=False,
        retention_until=None,
    )
    sig = SimpleNamespace(
        id="s1",
        signer_user_id="u1",
        signer_role="customer",
        signed_at=None,
        status="pending",
        provider_name="kontur",
        provider_external_id="ext-1",
        signature_type="kontur",
    )
    out = document_dict(doc, None, [sig])
    assert out["meta"]["signatures"][0]["provider"] == "kontur"
    assert out["meta"]["signatures"][0]["provider_name"] == "kontur"
