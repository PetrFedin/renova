"""Wave 3b: e-sign registry."""
import pytest

from app.services.esign.registry import get_provider, list_providers
from app.services.project_document_service import create_document, sign_document


def test_list_providers_includes_in_app_and_stubs():
    names = {p["name"] for p in list_providers()}
    assert names >= {"in_app", "kontur", "goskey"}
    by = {p["name"]: p for p in list_providers()}
    assert by["in_app"]["available"] is True
    assert by["kontur"]["available"] is False


@pytest.mark.asyncio
async def test_sign_in_app_via_registry(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор",
        document_type="contract",
    )
    sig = await sign_document(
        db,
        doc,
        signer_user_id="u1",
        signer_role="customer",
        provider="in_app",
    )
    assert sig.provider_name == "in_app"
    assert sig.provider_external_id and sig.provider_external_id.startswith("inapp-")


@pytest.mark.asyncio
async def test_sign_kontur_unavailable(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор 2",
        document_type="contract",
    )
    with pytest.raises(ValueError, match="provider_unavailable:kontur"):
        await sign_document(
            db,
            doc,
            signer_user_id="u1",
            signer_role="customer",
            provider="kontur",
        )


@pytest.mark.asyncio
async def test_kontur_sandbox_pending_and_webhook(db, monkeypatch):
    from app.core import config as cfg
    from app.services.esign.registry import get_provider, list_providers
    from app.services.project_document_service import (
        complete_external_signature,
        create_document,
        sign_document,
    )

    monkeypatch.setattr(cfg.settings, "kontur_mode", "sandbox")
    monkeypatch.setattr(cfg.settings, "kontur_api_key", "test-key-not-secret")

    by = {p["name"]: p for p in list_providers()}
    assert by["kontur"]["available"] is True

    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор kontur",
        document_type="contract",
    )
    sig = await sign_document(
        db,
        doc,
        signer_user_id="u1",
        signer_role="customer",
        provider="kontur",
    )
    assert sig.status == "pending"
    assert sig.provider_external_id and sig.provider_external_id.startswith("kontur-")
    assert sig.signed_at is None

    done = await complete_external_signature(
        db,
        provider_name="kontur",
        external_id=sig.provider_external_id,
        status="signed",
    )
    assert done is not None
    assert done.status == "signed"
    assert done.signed_at is not None
