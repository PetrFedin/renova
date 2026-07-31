from datetime import datetime
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.router import api_router
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import DomainOutbox, Project, User, UserRole
import app.models.outbox_runtime  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentVersion,
    ProjectDocument,
)
import app.models.work_schedule  # noqa: F401
from app.services import (
    document_lifecycle_service,
    document_state_lifecycle_service,
    outbox_inline_dispatch,
)


@pytest_asyncio.fixture
async def document_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_document(db):
    customer = User(
        id="customer-document",
        phone="+79990000701",
        role=UserRole.customer,
    )
    contractor = User(
        id="contractor-document",
        phone="+79990000702",
        role=UserRole.contractor,
    )
    project = Project(
        id="project-document",
        name="Document lifecycle",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    document = ProjectDocument(
        id="document-atomicity",
        project_id=project.id,
        title="Договор подряда",
        document_type="contract",
        status=DocumentStatus.active.value,
        current_version_id="document-version",
        created_by=customer.id,
    )
    version = DocumentVersion(
        id="document-version",
        document_id=document.id,
        version_number=1,
        mime_type="application/pdf",
        checksum_sha256="a" * 64,
        href="/documents/contract.pdf",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, project, document, version])
    await db.commit()
    return customer, contractor, project, document, version


def _routes(path: str, method: str):
    return [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == f"/api/v1{path}"
        and method in set(getattr(route, "methods", set()) or set())
    ]


def test_router_exposes_one_canonical_handler_per_document_state_path():
    paths = [
        ("/projects/{project_id}/documents/{document_id}/sign", "POST"),
        ("/projects/{project_id}/documents/{document_id}/archive", "POST"),
        ("/projects/{project_id}/documents/{document_id}/restore", "POST"),
        ("/projects/{project_id}/documents/{document_id}", "DELETE"),
        ("/projects/{project_id}/documents/{document_id}/legal-hold", "POST"),
    ]
    for path, method in paths:
        routes = _routes(path, method)
        assert len(routes) == 1
        assert routes[0].endpoint.__module__.endswith("document_lifecycle")


@pytest.mark.asyncio
async def test_sign_commits_signature_and_effects_once_then_replays(
    document_db,
    monkeypatch,
):
    customer, _, project, document, _ = await seed_document(document_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    signature, replayed = await document_lifecycle_service.sign_document(
        document_db,
        project=project,
        document=document,
        actor=customer,
        signature_type="in_app",
        content_hash=None,
        provider=None,
    )

    assert replayed is False
    assert signature.status == "signed"
    assert await document_db.scalar(
        select(func.count()).select_from(DocumentSignature)
    ) == 1
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await document_db.scalar(
        select(func.count()).select_from(DomainOutboxLease)
    ) == 2

    replay, replayed = await document_lifecycle_service.sign_document(
        document_db,
        project=project,
        document=document,
        actor=customer,
        signature_type="in_app",
        content_hash=None,
        provider=None,
    )

    assert replay.id == signature.id
    assert replayed is True
    assert await document_db.scalar(
        select(func.count()).select_from(DocumentSignature)
    ) == 1
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    inline_dispatch.assert_awaited_once_with(
        document_db,
        source="document.sign",
        limit=10,
    )


@pytest.mark.asyncio
async def test_sign_rolls_back_signature_when_effect_prepare_fails(
    document_db,
    monkeypatch,
):
    customer, _, project, document, _ = await seed_document(document_db)
    document_id = document.id
    monkeypatch.setattr(
        document_lifecycle_service,
        "_enqueue_sign_effects",
        AsyncMock(side_effect=RuntimeError("document_sign_effect_failed")),
    )

    with pytest.raises(RuntimeError, match="document_sign_effect_failed"):
        await document_lifecycle_service.sign_document(
            document_db,
            project=project,
            document=document,
            actor=customer,
            signature_type="in_app",
            content_hash=None,
            provider=None,
        )

    assert await document_db.scalar(
        select(func.count()).select_from(DocumentSignature)
    ) == 0
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await document_db.scalar(
        select(ProjectDocument.status).where(ProjectDocument.id == document_id)
    ) == DocumentStatus.active.value


@pytest.mark.asyncio
async def test_archive_commits_state_and_effects_once_then_replays(
    document_db,
    monkeypatch,
):
    _, contractor, project, document, _ = await seed_document(document_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    archived, replayed = await document_lifecycle_service.archive_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )

    assert replayed is False
    assert archived.status == DocumentStatus.archived.value
    assert archived.archived_at is not None
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await document_db.scalar(
        select(func.count()).select_from(DomainOutboxLease)
    ) == 2

    archived, replayed = await document_lifecycle_service.archive_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )

    assert replayed is True
    assert archived.status == DocumentStatus.archived.value
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    inline_dispatch.assert_awaited_once_with(
        document_db,
        source="document.archive",
        limit=10,
    )


@pytest.mark.asyncio
async def test_archive_rolls_back_state_when_effect_prepare_fails(
    document_db,
    monkeypatch,
):
    _, contractor, project, document, _ = await seed_document(document_db)
    document_id = document.id
    monkeypatch.setattr(
        document_lifecycle_service,
        "_enqueue_archive_effects",
        AsyncMock(side_effect=RuntimeError("document_archive_effect_failed")),
    )

    with pytest.raises(RuntimeError, match="document_archive_effect_failed"):
        await document_lifecycle_service.archive_document(
            document_db,
            project=project,
            document=document,
            actor=contractor,
        )

    row = (
        await document_db.execute(
            select(ProjectDocument.status, ProjectDocument.archived_at).where(
                ProjectDocument.id == document_id
            )
        )
    ).one()
    assert row.status == DocumentStatus.active.value
    assert row.archived_at is None
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await document_db.scalar(
        select(func.count()).select_from(DomainOutboxLease)
    ) == 0


@pytest.mark.asyncio
async def test_restore_is_atomic_and_replay_safe(document_db, monkeypatch):
    _, contractor, project, document, _ = await seed_document(document_db)
    document.status = DocumentStatus.archived.value
    document.archived_at = datetime(2026, 7, 31, 12, 0, 0)
    await document_db.commit()
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    restored, replayed = await document_state_lifecycle_service.restore_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )

    assert replayed is False
    assert restored.status == DocumentStatus.active.value
    assert restored.archived_at is None
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2

    restored, replayed = await document_state_lifecycle_service.restore_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )
    assert replayed is True
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    inline_dispatch.assert_awaited_once_with(
        document_db,
        source="document.restore",
        limit=10,
    )


@pytest.mark.asyncio
async def test_delete_is_atomic_replay_safe_and_blocked_by_legal_hold(
    document_db,
    monkeypatch,
):
    _, contractor, project, document, _ = await seed_document(document_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    document.legal_hold = True
    await document_db.commit()
    with pytest.raises(ValueError, match="legal_hold_blocks_delete"):
        await document_state_lifecycle_service.delete_document(
            document_db,
            project=project,
            document=document,
            actor=contractor,
        )
    assert document.status == DocumentStatus.active.value

    document.legal_hold = False
    await document_db.commit()
    deleted, replayed = await document_state_lifecycle_service.delete_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )
    assert replayed is False
    assert deleted.status == DocumentStatus.deleted.value
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2

    deleted, replayed = await document_state_lifecycle_service.delete_document(
        document_db,
        project=project,
        document=document,
        actor=contractor,
    )
    assert replayed is True
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    inline_dispatch.assert_awaited_once_with(
        document_db,
        source="document.delete",
        limit=10,
    )


@pytest.mark.asyncio
async def test_legal_hold_is_atomic_replay_safe_and_clears_retention(
    document_db,
    monkeypatch,
):
    customer, _, project, document, _ = await seed_document(document_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)
    retention = datetime(2028, 7, 31, 12, 0, 0)

    held, replayed = await document_state_lifecycle_service.set_legal_hold(
        document_db,
        project=project,
        document=document,
        actor=customer,
        enabled=True,
        retention_until=retention,
    )
    assert replayed is False
    assert held.legal_hold is True
    assert held.retention_until == retention
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2

    held, replayed = await document_state_lifecycle_service.set_legal_hold(
        document_db,
        project=project,
        document=document,
        actor=customer,
        enabled=True,
        retention_until=retention,
    )
    assert replayed is True
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2

    released, replayed = await document_state_lifecycle_service.set_legal_hold(
        document_db,
        project=project,
        document=document,
        actor=customer,
        enabled=False,
        retention_until=retention,
    )
    assert replayed is False
    assert released.legal_hold is False
    assert released.retention_until is None
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 4
    assert inline_dispatch.await_count == 2


@pytest.mark.asyncio
async def test_restore_rolls_back_state_when_effect_prepare_fails(
    document_db,
    monkeypatch,
):
    _, contractor, project, document, _ = await seed_document(document_db)
    document.status = DocumentStatus.archived.value
    document.archived_at = datetime(2026, 7, 31, 12, 0, 0)
    await document_db.commit()
    document_id = document.id
    monkeypatch.setattr(
        document_state_lifecycle_service,
        "_prepare_effects",
        AsyncMock(side_effect=RuntimeError("document_state_effect_failed")),
    )

    with pytest.raises(RuntimeError, match="document_state_effect_failed"):
        await document_state_lifecycle_service.restore_document(
            document_db,
            project=project,
            document=document,
            actor=contractor,
        )

    row = (
        await document_db.execute(
            select(ProjectDocument.status, ProjectDocument.archived_at).where(
                ProjectDocument.id == document_id
            )
        )
    ).one()
    assert row.status == DocumentStatus.archived.value
    assert row.archived_at is not None
    assert await document_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
