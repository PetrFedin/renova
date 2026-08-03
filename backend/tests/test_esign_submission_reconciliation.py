from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.models.entities import DomainOutbox, Project, User, UserRole
from app.models.project_documents import DocumentSignature, DocumentStatus, DocumentType
from app.services import outbox_service
from app.services.esign.base import SignResult
from app.services.project_document_service import create_document, sign_document


class AcceptingProvider:
    name = "kontur"
    display_name = "Synthetic Kontur"

    def __init__(self):
        self.idempotency_keys: list[str | None] = []

    def is_available(self) -> bool:
        return True

    async def create_signature(self, request):
        self.idempotency_keys.append(request.idempotency_key)
        return SignResult(
            status="pending",
            provider_name=self.name,
            external_id="provider-signature-fixed",
            signature_type=self.name,
            meta={"provider_status": "accepted"},
        )


async def seed_document(db, suffix: str):
    user = User(
        id=f"esign-reconcile-user-{suffix}",
        phone=f"+7998{len(suffix):07d}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"esign-reconcile-project-{suffix}",
        name="E-sign reconciliation",
        renovation_type="cosmetic",
        customer_id=user.id,
    )
    db.add_all([user, project])
    await db.flush()
    document = await create_document(
        db,
        project_id=project.id,
        created_by=user.id,
        title="Договор",
        document_type=DocumentType.contract.value,
        mime_type="application/pdf",
        checksum_sha256="a" * 64,
    )
    document.status = DocumentStatus.draft.value
    await db.commit()
    return user, document


def install_provider(monkeypatch, provider):
    # Both the request path and the outbox worker resolve providers through the
    # registry at call time. Patching the source of truth exercises that contract.
    monkeypatch.setattr("app.services.esign.registry.get_provider", lambda _name: provider)


@pytest.mark.asyncio
async def test_external_submission_commits_intent_before_provider_and_completes_outbox(db, monkeypatch):
    user, document = await seed_document(db, "fast")
    provider = AcceptingProvider()
    install_provider(monkeypatch, provider)

    signature = await sign_document(
        db,
        document,
        signer_user_id=user.id,
        signer_role="customer",
        provider="kontur",
    )

    assert signature.status == "pending"
    assert signature.provider_external_id == "provider-signature-fixed"
    assert len(provider.idempotency_keys) == 1
    assert provider.idempotency_keys[0]

    event = (
        await db.execute(
            select(DomainOutbox).where(
                DomainOutbox.aggregate_type == "document_signature",
                DomainOutbox.aggregate_id == signature.id,
                DomainOutbox.event_type == outbox_service.ESIGN_SUBMISSION_EVENT,
            )
        )
    ).scalar_one()
    assert event.processed_at is not None
    assert event.attempts == 1


@pytest.mark.asyncio
async def test_provider_acceptance_is_reconciled_after_local_completion_failure(db, monkeypatch):
    user, document = await seed_document(db, "retry")
    user_id = user.id
    document_id = document.id
    provider = AcceptingProvider()
    install_provider(monkeypatch, provider)

    original_release_success = outbox_service._release_success
    release_calls = 0

    async def fail_first_completion(*args, **kwargs):
        nonlocal release_calls
        release_calls += 1
        if release_calls == 1:
            raise RuntimeError("synthetic_local_commit_window")
        return await original_release_success(*args, **kwargs)

    monkeypatch.setattr(outbox_service, "_release_success", fail_first_completion)
    monkeypatch.setattr(outbox_service, "_retry_delay", lambda _attempts: timedelta(0))

    # The API remains fail-closed for the caller, while the committed intent is
    # retained for reconciliation instead of pretending the provider call failed.
    with pytest.raises(ValueError, match="synthetic_local_commit_window"):
        await sign_document(
            db,
            document,
            signer_user_id=user_id,
            signer_role="customer",
            provider="kontur",
        )

    # Rollback expires ORM instances by design; query using immutable identities
    # captured before the simulated local completion failure.
    signature = (
        await db.execute(
            select(DocumentSignature).where(
                DocumentSignature.document_id == document_id,
                DocumentSignature.signer_user_id == user_id,
                DocumentSignature.provider_name == "kontur",
            )
        )
    ).scalar_one()
    assert signature.status == "submitting"
    assert signature.provider_external_id is None
    assert len(provider.idempotency_keys) == 1

    processed = await outbox_service.dispatch_pending(db, limit=10, worker_id="esign-reconcile-test")
    assert processed == 1
    await db.refresh(signature)

    assert signature.status == "pending"
    assert signature.provider_external_id == "provider-signature-fixed"
    assert len(provider.idempotency_keys) == 2
    assert provider.idempotency_keys[0] == provider.idempotency_keys[1]

    signature_count = await db.scalar(
        select(func.count())
        .select_from(DocumentSignature)
        .where(
            DocumentSignature.document_id == document_id,
            DocumentSignature.signer_user_id == user_id,
            DocumentSignature.provider_name == "kontur",
        )
    )
    assert signature_count == 1

    event = (
        await db.execute(
            select(DomainOutbox).where(
                DomainOutbox.aggregate_type == "document_signature",
                DomainOutbox.aggregate_id == signature.id,
                DomainOutbox.event_type == outbox_service.ESIGN_SUBMISSION_EVENT,
            )
        )
    ).scalar_one()
    assert event.processed_at is not None
    assert event.attempts == 2
    assert event.last_error is None
