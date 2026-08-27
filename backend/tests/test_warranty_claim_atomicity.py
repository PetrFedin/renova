"""Warranty claim atomicity/idempotency contracts on the shared write ledger."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.v1.router import api_router
from app.api.v1.warranty import WarrantyClaimIn
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import outbox_service as outbox
from app.services import warranty_claim_service as warranty
from app.services.client_write_idempotency import IdempotencyConflict


async def _no_inline(*_args, **_kwargs) -> int:
    return 0


async def _seed_project(db, *, suffix: str = "one") -> tuple[User, User, Project]:
    customer = User(
        id=f"warranty-customer-{suffix}",
        phone=f"+79661110{suffix[-1] if suffix[-1:].isdigit() else '1'}01",
        role=UserRole.customer,
        full_name=f"Warranty customer {suffix}",
    )
    contractor = User(
        id=f"warranty-contractor-{suffix}",
        phone=f"+79662220{suffix[-1] if suffix[-1:].isdigit() else '1'}02",
        role=UserRole.contractor,
        full_name=f"Warranty contractor {suffix}",
    )
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        id=f"warranty-project-{suffix}",
        name=f"Warranty project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.commit()
    return customer, contractor, project


async def _count_claim_rows(db, *, project_id: str, request_id: str, issue_id: str) -> dict[str, int]:
    issue_count = int(
        await db.scalar(
            select(func.count()).select_from(ProjectIssue).where(
                ProjectIssue.project_id == project_id,
                ProjectIssue.id == issue_id,
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
    ledger_count = int(
        await db.scalar(
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.scope == warranty.WARRANTY_CLAIM_CREATE_SCOPE,
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.request_id == request_id,
            )
        )
        or 0
    )
    outbox_count = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "warranty_claim",
                DomainOutbox.aggregate_id == issue_id,
                DomainOutbox.event_type.in_([outbox.ACTIVITY_EVENT, outbox.NOTIFICATION_EVENT]),
            )
        )
        or 0
    )
    return {
        "issues": issue_count,
        "documents": document_count,
        "ledger": ledger_count,
        "outbox": outbox_count,
    }


@pytest.mark.asyncio
async def test_same_request_replays_one_claim_and_one_effect_set(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="1")
    request_id = "warranty-replay-request-0001"

    first = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Трещина стены",
        description="После сдачи появилась трещина",
        client_request_id=request_id,
    )
    second = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Трещина стены",
        description="После сдачи появилась трещина",
        client_request_id=request_id,
    )

    assert first.created is True
    assert second.created is False
    assert second.issue_id == first.issue_id
    assert second.document_id == first.document_id
    assert second.due_at == first.due_at
    assert await _count_claim_rows(
        db,
        project_id=project.id,
        request_id=request_id,
        issue_id=first.issue_id,
    ) == {"issues": 1, "documents": 1, "ledger": 1, "outbox": 2}


@pytest.mark.asyncio
async def test_same_request_with_different_payload_is_conflict(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="2")
    project_id = project.id
    request_id = "warranty-conflict-request-0002"

    first = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Протечка",
        description="Первая версия",
        client_request_id=request_id,
    )

    with pytest.raises(IdempotencyConflict):
        await warranty.create_or_replay_warranty_claim(
            db,
            project=project,
            user_id=customer.id,
            title="Протечка изменена",
            description="Вторая версия",
            client_request_id=request_id,
        )

    assert await _count_claim_rows(
        db,
        project_id=project_id,
        request_id=request_id,
        issue_id=first.issue_id,
    ) == {"issues": 1, "documents": 1, "ledger": 1, "outbox": 2}


@pytest.mark.asyncio
async def test_document_failure_rolls_back_issue_ledger_and_outbox(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="3")
    project_id = project.id
    request_id = "warranty-rollback-request-0003"

    async def fail_document(*_args, **_kwargs):
        raise RuntimeError("simulated_warranty_document_failure")

    monkeypatch.setattr(warranty.docs_svc, "create_document", fail_document)

    with pytest.raises(RuntimeError, match="simulated_warranty_document_failure"):
        await warranty.create_or_replay_warranty_claim(
            db,
            project=project,
            user_id=customer.id,
            title="Rollback claim",
            description="Must leave no partial object",
            client_request_id=request_id,
        )

    assert int(
        await db.scalar(
            select(func.count()).select_from(ProjectIssue).where(
                ProjectIssue.project_id == project_id,
                ProjectIssue.title == "[Гарантия] Rollback claim",
            )
        )
        or 0
    ) == 0
    assert int(
        await db.scalar(
            select(func.count()).select_from(ProjectDocument).where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.document_type == DocumentType.warranty.value,
            )
        )
        or 0
    ) == 0
    assert int(
        await db.scalar(
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.request_id == request_id,
            )
        )
        or 0
    ) == 0
    assert int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "warranty_claim",
            )
        )
        or 0
    ) == 0


@pytest.mark.asyncio
async def test_idempotency_scope_is_user_and_project_specific(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, contractor, project = await _seed_project(db, suffix="4")
    request_id = "warranty-shared-scope-request-0004"

    customer_claim = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Customer claim",
        description=None,
        client_request_id=request_id,
    )
    contractor_claim = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=contractor.id,
        title="Contractor claim",
        description=None,
        client_request_id=request_id,
    )

    assert customer_claim.issue_id != contractor_claim.issue_id
    ledger_count = int(
        await db.scalar(
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.scope == warranty.WARRANTY_CLAIM_CREATE_SCOPE,
                ClientWriteRequest.project_id == project.id,
                ClientWriteRequest.request_id == request_id,
            )
        )
        or 0
    )
    assert ledger_count == 2


def test_warranty_create_requires_client_request_id():
    with pytest.raises(ValidationError):
        WarrantyClaimIn(title="No identity")


def test_router_has_one_canonical_create_and_keeps_legacy_reads_and_close():
    matching = []
    for route in api_router.routes:
        path = getattr(route, "path", "")
        canonical_path = path.removeprefix("/api/v1")
        methods = set(getattr(route, "methods", set()) or set())
        if "warranty-claims" in canonical_path:
            matching.append((canonical_path, methods, getattr(route, "endpoint", None)))

    creates = [item for item in matching if item[0] == "/projects/{project_id}/warranty-claims" and "POST" in item[1]]
    reads = [item for item in matching if item[0] == "/projects/{project_id}/warranty-claims" and "GET" in item[1]]
    closes = [item for item in matching if item[0] == "/projects/{project_id}/warranty-claims/{issue_id}/close" and "POST" in item[1]]

    assert len(creates) == 1
    assert creates[0][2].__module__ == "app.api.v1.warranty"
    assert len(reads) == 1
    assert len(closes) == 1
