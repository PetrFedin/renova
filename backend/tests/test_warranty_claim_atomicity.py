"""Warranty claim atomicity/idempotency contracts on the shared write ledger."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.v1 import export as legacy_export
from app.api.v1 import warranty as warranty_api
from app.api.v1.warranty import WarrantyClaimIn
from app.main import app
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import client_write_side_effects
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


async def _counts(db, *, project_id: str, request_id: str, issue_id: str) -> tuple[int, int, int, int]:
    issues = int(
        await db.scalar(
            select(func.count()).select_from(ProjectIssue).where(
                ProjectIssue.project_id == project_id,
                ProjectIssue.id == issue_id,
            )
        )
        or 0
    )
    documents = int(
        await db.scalar(
            select(func.count()).select_from(ProjectDocument).where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.document_type == DocumentType.warranty.value,
                ProjectDocument.notes.contains(f"warranty_issue:{issue_id}"),
            )
        )
        or 0
    )
    ledger = int(
        await db.scalar(
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.scope == warranty.WARRANTY_CLAIM_CREATE_SCOPE,
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.request_id == request_id,
            )
        )
        or 0
    )
    effects = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "warranty_claim",
                DomainOutbox.aggregate_id == issue_id,
                DomainOutbox.event_type.in_([outbox.ACTIVITY_EVENT, outbox.NOTIFICATION_EVENT]),
            )
        )
        or 0
    )
    return issues, documents, ledger, effects


@pytest.mark.asyncio
async def test_same_request_replays_one_claim_and_one_effect_set(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="1")
    project_id = project.id
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
    assert (second.issue_id, second.document_id) == (first.issue_id, first.document_id)
    assert await _counts(
        db,
        project_id=project_id,
        request_id=request_id,
        issue_id=first.issue_id,
    ) == (1, 1, 1, 2)


@pytest.mark.asyncio
async def test_same_request_different_payload_conflicts_without_expired_orm_reads(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="2")
    project_id = project.id
    request_id = "warranty-conflict-request-0002"

    first = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Протечка",
        description="Первая",
        client_request_id=request_id,
    )
    with pytest.raises(IdempotencyConflict):
        await warranty.create_or_replay_warranty_claim(
            db,
            project=project,
            user_id=customer.id,
            title="Другая",
            description="Вторая",
            client_request_id=request_id,
        )

    assert await _counts(
        db,
        project_id=project_id,
        request_id=request_id,
        issue_id=first.issue_id,
    ) == (1, 1, 1, 2)


@pytest.mark.asyncio
async def test_document_failure_rolls_back_everything(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, _, project = await _seed_project(db, suffix="3")
    project_id = project.id
    request_id = "warranty-rollback-request-0003"

    async def fail_document(*_args, **_kwargs):
        raise RuntimeError("document_failure")

    monkeypatch.setattr(warranty.docs_svc, "create_document", fail_document)
    with pytest.raises(RuntimeError, match="document_failure"):
        await warranty.create_or_replay_warranty_claim(
            db,
            project=project,
            user_id=customer.id,
            title="Rollback claim",
            description=None,
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
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.request_id == request_id,
            )
        )
        or 0
    ) == 0


@pytest.mark.asyncio
async def test_outbox_failure_rolls_back_issue_document_and_ledger(db, monkeypatch):
    customer, _, project = await _seed_project(db, suffix="5")
    project_id = project.id
    request_id = "warranty-outbox-failure-0005"

    async def fail_prepare(*_args, **_kwargs):
        raise RuntimeError("outbox_failure")

    monkeypatch.setattr(client_write_side_effects, "prepare_client_write_side_effects", fail_prepare)
    with pytest.raises(RuntimeError, match="outbox_failure"):
        await warranty.create_or_replay_warranty_claim(
            db,
            project=project,
            user_id=customer.id,
            title="Outbox rollback",
            description=None,
            client_request_id=request_id,
        )

    assert int(
        await db.scalar(
            select(func.count()).select_from(ProjectIssue).where(
                ProjectIssue.project_id == project_id,
                ProjectIssue.title == "[Гарантия] Outbox rollback",
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


@pytest.mark.asyncio
async def test_scope_is_user_specific(db, monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    customer, contractor, project = await _seed_project(db, suffix="4")
    request_id = "warranty-shared-scope-request-0004"

    first = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer.id,
        title="Customer",
        description=None,
        client_request_id=request_id,
    )
    second = await warranty.create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=contractor.id,
        title="Contractor",
        description=None,
        client_request_id=request_id,
    )
    assert first.issue_id != second.issue_id


def test_warranty_create_requires_client_request_id():
    with pytest.raises(ValidationError):
        WarrantyClaimIn(title="No identity")


def _routes(router, *, suffix: str, method: str) -> list[object]:
    return [
        route
        for route in router.routes
        if getattr(route, "path", "").endswith(suffix)
        and method in set(getattr(route, "methods", set()) or set())
    ]


def test_router_has_one_canonical_create_and_keeps_reads_close():
    canonical_source = _routes(
        warranty_api.router,
        suffix="/{project_id}/warranty-claims",
        method="POST",
    )
    legacy_creates = _routes(
        legacy_export.router,
        suffix="/{project_id}/warranty-claims",
        method="POST",
    )
    reads = _routes(
        legacy_export.router,
        suffix="/{project_id}/warranty-claims",
        method="GET",
    )
    closes = _routes(
        legacy_export.router,
        suffix="/{project_id}/warranty-claims/{issue_id}/close",
        method="POST",
    )
    schema = app.openapi()
    production_path = schema.get("paths", {}).get(
        "/api/v1/projects/{project_id}/warranty-claims",
        {},
    )

    assert len(canonical_source) == 1
    assert getattr(canonical_source[0], "endpoint", None) is warranty_api.create_warranty_claim
    assert legacy_creates == []
    assert len(reads) == 1
    assert len(closes) == 1
    assert "post" in production_path
    assert production_path["post"]["operationId"].startswith("create_warranty_claim_")
