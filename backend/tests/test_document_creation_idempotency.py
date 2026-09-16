"""P0 #316: ProjectDocument metadata creation is atomic and replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.document_creation_integrity import DocumentCreateCommand, create_project_document_integrity
from app.api.v1.router import api_router
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, User, UserRole
from app.models.project_documents import DocumentVersion, ProjectDocument

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008301", role=UserRole.customer, full_name="Document customer")
    db.add(customer)
    await db.flush()
    project = Project(
        name="Document replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(project)
    await db.commit()
    return customer, project


async def test_document_metadata_response_loss_replay_creates_one_document_and_version(db):
    customer, project = await _fixture(db)
    body = DocumentCreateCommand(
        title="Договор",
        document_type="contract",
        notes="metadata only",
        client_request_id="document-response-loss-0001",
    )

    first = await create_project_document_integrity(project.id, body, customer, db)
    replay = await create_project_document_integrity(project.id, body, customer, db)

    assert replay["id"] == first["id"]
    assert first["idempotent_replay"] is False
    assert replay["idempotent_replay"] is True

    document_count = await db.scalar(
        select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id == project.id)
    )
    version_count = await db.scalar(
        select(func.count()).select_from(DocumentVersion).join(
            ProjectDocument, ProjectDocument.id == DocumentVersion.document_id
        ).where(ProjectDocument.project_id == project.id)
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "document.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert document_count == 1
    assert version_count == 1
    assert ledger_count == 1


async def test_document_metadata_same_request_id_different_payload_conflicts(db):
    customer, project = await _fixture(db)
    request_id = "document-conflict-0001"
    await create_project_document_integrity(
        project.id,
        DocumentCreateCommand(title="Документ А", client_request_id=request_id),
        customer,
        db,
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_project_document_integrity(
            project.id,
            DocumentCreateCommand(title="Документ Б", client_request_id=request_id),
            customer,
            db,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    document_count = await db.scalar(
        select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id == project.id)
    )
    assert document_count == 1


def test_document_create_runtime_has_one_canonical_handler():
    path = "/api/v1/projects/{project_id}/documents"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("document_creation_integrity")
