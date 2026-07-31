"""Wave 3b: e-sign registry."""
from unittest.mock import AsyncMock

import pytest

from app.services.esign.registry import list_providers
from app.services.project_document_service import create_document, sign_document


def test_list_providers_includes_in_app_and_external_providers():
    names = {provider["name"] for provider in list_providers()}
    assert names >= {"in_app", "kontur", "goskey"}
    by_name = {provider["name"]: provider for provider in list_providers()}
    assert by_name["in_app"]["available"] is True
    assert by_name["kontur"]["available"] is False


@pytest.mark.asyncio
async def test_sign_in_app_via_registry(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор",
        document_type="contract",
    )
    signature = await sign_document(
        db,
        doc,
        signer_user_id="u1",
        signer_role="customer",
        provider="in_app",
    )
    assert signature.provider_name == "in_app"
    assert signature.provider_external_id and signature.provider_external_id.startswith("inapp-")


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


def configure_kontur(monkeypatch):
    from app.core import config as cfg
    from app.services.esign.registry import get_provider

    monkeypatch.setattr(cfg.settings, "kontur_mode", "sandbox")
    monkeypatch.setattr(cfg.settings, "kontur_api_key", "test-key-not-secret")
    monkeypatch.setattr(cfg.settings, "kontur_api_url", "https://kontur.test/api")
    monkeypatch.setattr(cfg.settings, "esign_webhook_secret", "webhook-secret")
    provider = get_provider("kontur")
    submit = AsyncMock(
        return_value={
            "external_id": "kontur-test-signature",
            "status": "accepted",
            "signing_url": "https://kontur.test/sign/1",
            "provider_request_id": "request-1",
        }
    )
    monkeypatch.setattr(provider, "_submit_http", submit)
    return provider, submit


@pytest.mark.asyncio
async def test_kontur_sandbox_pending_and_webhook(db, monkeypatch):
    from app.services.esign.registry import list_providers
    from app.services.project_document_service import complete_external_signature

    provider, submit = configure_kontur(monkeypatch)
    by_name = {item["name"]: item for item in list_providers()}
    assert by_name["kontur"]["available"] is True

    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор kontur",
        document_type="contract",
        checksum_sha256="a" * 64,
    )
    signature = await sign_document(
        db,
        doc,
        signer_user_id="u1",
        signer_role="customer",
        provider="kontur",
    )
    submit.assert_awaited_once()
    assert provider.is_available() is True
    assert signature.status == "pending"
    assert signature.provider_external_id == "kontur-test-signature"
    assert signature.signed_at is None

    completed = await complete_external_signature(
        db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="signed",
    )
    assert completed is not None
    assert completed.status == "signed"
    assert completed.signed_at is not None


@pytest.mark.asyncio
async def test_kontur_webhook_idempotent(db, monkeypatch):
    """Repeated webhook delivery must not rewrite signed_at."""
    from app.services.project_document_service import complete_external_signature

    configure_kontur(monkeypatch)
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор kontur dup",
        document_type="contract",
        checksum_sha256="b" * 64,
    )
    signature = await sign_document(
        db,
        doc,
        signer_user_id="u1",
        signer_role="customer",
        provider="kontur",
    )
    first = await complete_external_signature(
        db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="signed",
    )
    assert first is not None
    signed_at = first.signed_at
    assert signed_at is not None

    second = await complete_external_signature(
        db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="signed",
    )
    assert second is not None
    assert second.signed_at == signed_at


@pytest.mark.asyncio
async def test_esign_health_endpoint():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        response = await client.get("/api/v1/esign/health", headers={"X-User-Id": user["id"]})
        assert response.status_code == 200
        body = response.json()
        assert "webhook_kontur" in body
        assert body["webhook_kontur"].endswith("/api/v1/esign/webhooks/kontur")
        assert "kontur_mode" in body
