from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import esign as esign_api
from app.db.base import Base
from app.models.entities import Project, User, UserRole
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import project_document_service as docs_svc
from app.services.esign.base import SignRequest, SignResult
from app.services.esign.goskey import GoskeyESignProvider
from app.services.esign.kontur import KonturESignProvider
from app.services.esign.runtime import validate_esign_runtime


@pytest_asyncio.fixture
async def esign_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def kontur_settings(monkeypatch):
    monkeypatch.setattr(esign_api.settings, "environment", "test")
    monkeypatch.setattr(esign_api.settings, "public_base_url", "https://api.example.com")
    monkeypatch.setattr(esign_api.settings, "kontur_mode", "sandbox")
    monkeypatch.setattr(esign_api.settings, "kontur_api_key", "synthetic-kontur-key")
    monkeypatch.setattr(esign_api.settings, "kontur_api_url", "https://kontur.example.com/sign/v1")
    monkeypatch.setattr(esign_api.settings, "esign_webhook_secret", "esign-webhook-secret-32-characters")
    monkeypatch.setattr(esign_api.settings, "goskey_mode", "off")
    monkeypatch.setattr(esign_api.settings, "goskey_client_id", None)


class FakeResponse:
    def __init__(self, payload, status_code: int = 201):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://kontur.example.com")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("rejected", request=request, response=response)

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, *, json, headers):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def sign_request() -> SignRequest:
    return SignRequest(
        document_id="document-1",
        version_id="version-1",
        signer_user_id="user-1",
        signer_role="customer",
        content_hash="a" * 64,
        title="Договор",
        mime_type="application/pdf",
    )


def install_kontur_client(monkeypatch, response):
    client = FakeAsyncClient(response)
    monkeypatch.setattr(
        "app.services.esign.kontur.httpx.AsyncClient",
        lambda **_kwargs: client,
    )
    return client


@pytest.mark.asyncio
async def test_kontur_creates_pending_only_after_explicit_provider_acceptance(monkeypatch, kontur_settings):
    client = install_kontur_client(
        monkeypatch,
        FakeResponse(
            {
                "status": "accepted",
                "external_id": "provider-signature-1",
                "signing_url": "https://sign.example.com/request/1",
                "request_id": "request-1",
            }
        ),
    )

    result = await KonturESignProvider().create_signature(sign_request())

    assert result.status == "pending"
    assert result.external_id == "provider-signature-1"
    assert result.meta["signing_url"] == "https://sign.example.com/request/1"
    assert result.meta["provider_status"] == "accepted"
    assert len(client.calls) == 1
    assert client.calls[0]["headers"]["Idempotency-Key"]
    assert client.calls[0]["json"]["webhook_url"].endswith("/api/v1/esign/webhooks/kontur")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        (FakeResponse({"status": "accepted"}, status_code=503), "kontur_http_rejected"),
        (FakeResponse({"status": "unknown", "id": "provider-1"}), "kontur_unconfirmed_status"),
        (FakeResponse({"status": "failed", "id": "provider-1"}), "kontur_signature_rejected"),
        (FakeResponse({"status": "accepted", "id": "provider-1", "url": "http://unsafe.example"}), "kontur_signing_url_invalid"),
        (FakeResponse(ValueError("invalid json")), "kontur_delivery_failed"),
    ],
)
async def test_kontur_provider_errors_never_become_pending(monkeypatch, kontur_settings, response, expected_error):
    install_kontur_client(monkeypatch, response)

    result = await KonturESignProvider().create_signature(sign_request())

    assert result.status == "failed"
    assert result.external_id is None
    assert result.error == expected_error
    assert "signing_url" not in result.meta


@pytest.mark.asyncio
async def test_kontur_transport_error_never_generates_fake_external_request(monkeypatch, kontur_settings):
    request = httpx.Request("POST", "https://kontur.example.com")
    install_kontur_client(monkeypatch, httpx.ConnectError("offline", request=request))

    result = await KonturESignProvider().create_signature(sign_request())

    assert result.status == "failed"
    assert result.external_id is None
    assert result.error == "kontur_delivery_failed"


def test_kontur_is_unavailable_without_webhook_secret(monkeypatch, kontur_settings):
    monkeypatch.setattr(esign_api.settings, "esign_webhook_secret", None)
    assert KonturESignProvider().is_available() is False


@pytest.mark.asyncio
async def test_goskey_scaffold_is_never_advertised_as_available(monkeypatch, kontur_settings):
    monkeypatch.setattr(esign_api.settings, "goskey_mode", "live")
    monkeypatch.setattr(esign_api.settings, "goskey_client_id", "synthetic-client")

    provider = GoskeyESignProvider()
    result = await provider.create_signature(sign_request())

    assert provider.is_available() is False
    assert result.status == "unavailable"
    assert result.error == "provider_goskey_not_implemented"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ({"external_id": "ext-1", "status": "completed"}, ("ext-1", "signed")),
        ({"id": "ext-2", "status": "signature.failed"}, ("ext-2", "failed")),
        ({"object": {"id": "ext-3", "status": "processing"}}, ("ext-3", "pending")),
    ],
)
def test_webhook_parser_accepts_only_explicit_statuses(raw, expected):
    assert esign_api.parse_esign_webhook_payload(raw) == expected


@pytest.mark.parametrize(
    ("raw", "detail"),
    [
        ({"external_id": "ext-1"}, "status_required"),
        ({"external_id": "ext-1", "status": "signing"}, "unsupported_esign_status"),
        ({"external_id": "ext-1", "status": "signature.pending_review"}, "unsupported_esign_status"),
        ({"object": "not-a-dict", "status": "signed"}, "external_id_required"),
        ({"id": "a\nunsafe", "status": "signed"}, "external_id_required"),
    ],
)
def test_webhook_parser_fails_closed_without_500(raw, detail):
    with pytest.raises(HTTPException) as error:
        esign_api.parse_esign_webhook_payload(raw)
    assert error.value.status_code == 400
    assert error.value.detail == detail


def test_webhook_requires_secret_and_enabled_provider(monkeypatch, kontur_settings):
    secret = "esign-webhook-secret-32-characters"
    esign_api._check_webhook_secret("kontur", secret)

    with pytest.raises(HTTPException) as error:
        esign_api._check_webhook_secret("kontur", "wrong")
    assert error.value.status_code == 401

    monkeypatch.setattr(esign_api.settings, "esign_webhook_secret", None)
    with pytest.raises(HTTPException) as error:
        esign_api._check_webhook_secret("kontur", None)
    assert error.value.status_code == 503

    monkeypatch.setattr(esign_api.settings, "esign_webhook_secret", secret)
    monkeypatch.setattr(esign_api.settings, "kontur_mode", "off")
    with pytest.raises(HTTPException) as error:
        esign_api._check_webhook_secret("kontur", secret)
    assert error.value.status_code == 409


def test_esign_startup_guard_blocks_fake_or_partial_providers(monkeypatch, kontur_settings):
    monkeypatch.setattr(esign_api.settings, "kontur_mode", "off")
    monkeypatch.setattr(esign_api.settings, "goskey_mode", "off")
    validate_esign_runtime()

    monkeypatch.setattr(esign_api.settings, "kontur_mode", "live")
    monkeypatch.setattr(esign_api.settings, "environment", "production")
    monkeypatch.setattr(esign_api.settings, "kontur_api_url", "http://insecure.example")
    with pytest.raises(ValueError, match="HTTPS KONTUR_API_URL"):
        validate_esign_runtime()

    monkeypatch.setattr(esign_api.settings, "kontur_api_url", "https://kontur.example.com")
    monkeypatch.setattr(esign_api.settings, "esign_webhook_secret", "short")
    with pytest.raises(ValueError, match="at least 16"):
        validate_esign_runtime()

    monkeypatch.setattr(esign_api.settings, "kontur_mode", "off")
    monkeypatch.setattr(esign_api.settings, "goskey_mode", "live")
    with pytest.raises(ValueError, match="must remain off"):
        validate_esign_runtime()


async def seed_external_signature(db, *, suffix: str, status: str = "pending", checksum: str | None = None):
    user = User(
        id=f"esign-user-{suffix}",
        phone=f"+7999{len(suffix):07d}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"esign-project-{suffix}",
        name="E-sign project",
        renovation_type="cosmetic",
        customer_id=user.id,
    )
    document = ProjectDocument(
        id=f"esign-document-{suffix}",
        project_id=project.id,
        document_type=DocumentType.contract.value,
        title="Договор",
        status=DocumentStatus.draft.value,
        created_by=user.id,
    )
    version = DocumentVersion(
        id=f"esign-version-{suffix}",
        document_id=document.id,
        version_number=1,
        mime_type="application/pdf",
        checksum_sha256=checksum or ("b" * 64),
        created_by=user.id,
    )
    document.current_version_id = version.id
    signature = DocumentSignature(
        id=f"esign-signature-{suffix}",
        document_id=document.id,
        version_id=version.id,
        signer_user_id=user.id,
        signer_role="customer",
        signature_type="kontur",
        provider_name="kontur",
        provider_external_id=f"provider-{suffix}",
        content_hash=version.checksum_sha256,
        status=status,
    )
    db.add_all([user, project, document, version, signature])
    await db.commit()
    return user, project, document, version, signature


@pytest.mark.asyncio
async def test_external_signature_transition_is_monotonic_and_activates_document(esign_db):
    _, _, document, _, signature = await seed_external_signature(esign_db, suffix="signed")

    completed = await docs_svc.complete_external_signature(
        esign_db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="signed",
    )
    await esign_db.commit()

    assert completed.status == "signed"
    assert completed.signed_at is not None
    assert document.status == DocumentStatus.active.value

    duplicate = await docs_svc.complete_external_signature(
        esign_db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="signed",
    )
    assert duplicate.id == signature.id

    with pytest.raises(ValueError, match="signature_final_state_conflict"):
        await docs_svc.complete_external_signature(
            esign_db,
            provider_name="kontur",
            external_id=signature.provider_external_id,
            status="failed",
        )
    assert signature.status == "signed"


@pytest.mark.asyncio
async def test_failed_external_signature_cannot_be_resurrected(esign_db):
    _, _, _, _, signature = await seed_external_signature(esign_db, suffix="failed")

    failed = await docs_svc.complete_external_signature(
        esign_db,
        provider_name="kontur",
        external_id=signature.provider_external_id,
        status="failed",
    )
    assert failed.status == "failed"
    assert failed.revoked_at is not None
    assert failed.signed_at is None

    with pytest.raises(ValueError, match="signature_final_state_conflict"):
        await docs_svc.complete_external_signature(
            esign_db,
            provider_name="kontur",
            external_id=signature.provider_external_id,
            status="signed",
        )


@pytest.mark.asyncio
async def test_webhook_side_effects_run_once_and_duplicate_is_idempotent(
    esign_db,
    monkeypatch,
    kontur_settings,
):
    _, _, _, _, signature = await seed_external_signature(esign_db, suffix="webhook")
    effects = AsyncMock()
    monkeypatch.setattr(esign_api, "_side_effects_after_external_sign", effects)
    secret = "esign-webhook-secret-32-characters"

    first = await esign_api._process_provider_webhook(
        esign_db,
        provider="kontur",
        body={"external_id": signature.provider_external_id, "status": "completed"},
        supplied_secret=secret,
    )
    second = await esign_api._process_provider_webhook(
        esign_db,
        provider="kontur",
        body={"external_id": signature.provider_external_id, "status": "signed"},
        supplied_secret=secret,
    )

    assert first["status"] == "signed"
    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert effects.await_count == 1


@pytest.mark.asyncio
async def test_webhook_rejects_duplicate_provider_external_id(
    esign_db,
    kontur_settings,
):
    user, project, _, version, signature = await seed_external_signature(esign_db, suffix="duplicate")
    second_doc = ProjectDocument(
        id="esign-document-duplicate-2",
        project_id=project.id,
        document_type=DocumentType.contract.value,
        title="Договор 2",
        status=DocumentStatus.draft.value,
        created_by=user.id,
    )
    second_version = DocumentVersion(
        id="esign-version-duplicate-2",
        document_id=second_doc.id,
        version_number=1,
        mime_type="application/pdf",
        checksum_sha256="c" * 64,
        created_by=user.id,
    )
    second_doc.current_version_id = second_version.id
    esign_db.add_all(
        [
            second_doc,
            second_version,
            DocumentSignature(
                id="esign-signature-duplicate-2",
                document_id=second_doc.id,
                version_id=second_version.id,
                signer_user_id=user.id,
                signer_role="customer",
                signature_type="kontur",
                provider_name="kontur",
                provider_external_id=signature.provider_external_id,
                content_hash=second_version.checksum_sha256,
                status="pending",
            ),
        ]
    )
    await esign_db.commit()

    with pytest.raises(HTTPException) as error:
        await esign_api._process_provider_webhook(
            esign_db,
            provider="kontur",
            body={"external_id": signature.provider_external_id, "status": "signed"},
            supplied_secret="esign-webhook-secret-32-characters",
        )
    assert error.value.status_code == 409
    assert error.value.detail == "duplicate_provider_external_id"


@pytest.mark.asyncio
async def test_sign_document_reuses_existing_request_before_provider_call(
    esign_db,
    monkeypatch,
):
    user, _, document, _, signature = await seed_external_signature(esign_db, suffix="reuse")
    provider = SimpleNamespace(
        name="kontur",
        is_available=lambda: True,
        create_signature=AsyncMock(),
    )
    monkeypatch.setattr("app.services.esign.registry.get_provider", lambda _name: provider)

    result = await docs_svc.sign_document(
        esign_db,
        document,
        signer_user_id=user.id,
        signer_role="customer",
        provider="kontur",
    )

    assert result.id == signature.id
    provider.create_signature.assert_not_awaited()


@pytest.mark.asyncio
async def test_external_sign_requires_checksum_and_provider_external_id(
    esign_db,
    monkeypatch,
):
    user, _, document, version, signature = await seed_external_signature(esign_db, suffix="requirements")
    await esign_db.delete(signature)
    version.checksum_sha256 = None
    await esign_db.commit()
    provider = SimpleNamespace(
        name="kontur",
        is_available=lambda: True,
        create_signature=AsyncMock(),
    )
    monkeypatch.setattr("app.services.esign.registry.get_provider", lambda _name: provider)

    with pytest.raises(ValueError, match="content_hash_required"):
        await docs_svc.sign_document(
            esign_db,
            document,
            signer_user_id=user.id,
            signer_role="customer",
            provider="kontur",
        )
    provider.create_signature.assert_not_awaited()

    version.checksum_sha256 = "d" * 64
    provider.create_signature = AsyncMock(
        return_value=SignResult(
            status="pending",
            provider_name="kontur",
            signature_type="kontur",
            external_id=None,
        )
    )
    with pytest.raises(ValueError, match="external_signature_id_required"):
        await docs_svc.sign_document(
            esign_db,
            document,
            signer_user_id=user.id,
            signer_role="customer",
            provider="kontur",
        )


def test_integrity_contract_removes_fake_provider_paths():
    backend = Path(__file__).resolve().parents[1]
    kontur_source = (backend / "app" / "services" / "esign" / "kontur.py").read_text(encoding="utf-8")
    goskey_source = (backend / "app" / "services" / "esign" / "goskey.py").read_text(encoding="utf-8")
    webhook_source = (backend / "app" / "api" / "v1" / "esign.py").read_text(encoding="utf-8")
    main_source = (backend / "app" / "main.py").read_text(encoding="utf-8")

    assert "sign.kontur.ru/sandbox" not in kontur_source
    assert "Status 501 or sandbox fallback" not in kontur_source
    assert "return False" in goskey_source
    assert 'status: str = "signed"' not in webhook_source
    assert "hmac.compare_digest" in webhook_source
    assert "validate_esign_runtime()" in main_source
