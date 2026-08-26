"""Real PostgreSQL race proof for warranty claim creation."""

from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register canonical ORM metadata
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import outbox_service as outbox
from app.services import warranty_claim_service as warranty


def _postgres_url() -> str:
    value = os.environ.get("WARRANTY_CLAIM_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("WARRANTY_CLAIM_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


async def _no_inline(*_args, **_kwargs) -> int:
    return 0


@pytest.mark.asyncio
async def test_concurrent_same_request_collapses_to_one_claim_and_effect_set(monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)

    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "warranty-race-customer"
    contractor_id = "warranty-race-contractor"
    project_id = "warranty-race-project"
    request_id = "warranty-race-request-0001"
    title = "Concurrent warranty claim"
    description = "Two replicas must converge on one business object"

    try:
        async with Session() as db:
            customer = User(
                id=customer_id,
                phone="+79663330001",
                role=UserRole.customer,
                full_name="Warranty race customer",
            )
            contractor = User(
                id=contractor_id,
                phone="+79663330002",
                role=UserRole.contractor,
                full_name="Warranty race contractor",
            )
            db.add_all([customer, contractor])
            await db.flush()
            db.add(
                Project(
                    id=project_id,
                    name="Warranty idempotency race",
                    renovation_type="cosmetic",
                    customer_id=customer_id,
                    contractor_id=contractor_id,
                )
            )
            await db.commit()

        async def create_once() -> tuple[str, str]:
            async with Session() as db:
                project = await db.get(Project, project_id)
                assert project is not None
                result = await warranty.create_or_replay_warranty_claim(
                    db,
                    project=project,
                    user_id=customer_id,
                    title=title,
                    description=description,
                    client_request_id=request_id,
                )
                return result.issue_id, result.document_id

        first, second = await asyncio.gather(create_once(), create_once())
        assert first == second
        issue_id, document_id = first

        async with Session() as db:
            issue_count = int(
                await db.scalar(
                    select(func.count()).select_from(ProjectIssue).where(
                        ProjectIssue.project_id == project_id,
                        ProjectIssue.title == f"[Гарантия] {title}",
                    )
                )
                or 0
            )
            document_count = int(
                await db.scalar(
                    select(func.count()).select_from(ProjectDocument).where(
                        ProjectDocument.project_id == project_id,
                        ProjectDocument.document_type == DocumentType.warranty.value,
                        ProjectDocument.notes.contains(f"warranty_issue:{issue_id}"),
                    )
                )
                or 0
            )
            canonical_document = await db.get(ProjectDocument, document_id)
            ledger_count = int(
                await db.scalar(
                    select(func.count()).select_from(ClientWriteRequest).where(
                        ClientWriteRequest.scope == warranty.WARRANTY_CLAIM_CREATE_SCOPE,
                        ClientWriteRequest.project_id == project_id,
                        ClientWriteRequest.user_id == customer_id,
                        ClientWriteRequest.request_id == request_id,
                    )
                )
                or 0
            )
            effect_count = int(
                await db.scalar(
                    select(func.count()).select_from(DomainOutbox).where(
                        DomainOutbox.aggregate_type == "warranty_claim",
                        DomainOutbox.aggregate_id == issue_id,
                        DomainOutbox.event_type.in_([outbox.ACTIVITY_EVENT, outbox.NOTIFICATION_EVENT]),
                    )
                )
                or 0
            )

        assert issue_count == 1
        assert document_count == 1
        assert canonical_document is not None
        assert canonical_document.id == document_id
        assert ledger_count == 1
        assert effect_count == 2
    finally:
        await engine.dispose()
