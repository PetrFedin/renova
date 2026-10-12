"""Integration regression: one canonical acceptance powers both Action Queue and Verified Execution Record.

This is a read-model state-boundary test over a real isolated SQLAlchemy
session. It deliberately does NOT substitute for the canonical acceptance
mutation endpoint or production PostgreSQL, which remain separate CI gates.
"""
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    Project,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import (
    action_responsibility_service as actions,
    execution_proof_trust_service as trust,
    verified_execution_record_service as records,
)


async def _seed(db):
    owner = User(id="int-ver-owner", phone="+79995556001", role=UserRole.customer)
    lead = User(id="int-ver-lead", phone="+79995556002", role=UserRole.contractor)
    outsider = User(id="int-ver-outsider", phone="+79995556003", role=UserRole.customer)
    project = Project(
        id="int-ver-project",
        name="Integration execution proof",
        renovation_type="cosmetic",
        customer_id=owner.id,
        contractor_id=lead.id,
    )
    stage = Stage(
        id="int-ver-stage",
        project_id=project.id,
        name="Гидроизоляция",
        status=StageStatus.review,
        work_type="waterproofing",
        checklist_json='[{"title":"Проверена гидроизоляция","done":true}]',
    )
    acceptance = WorkAcceptance(
        id="int-ver-acceptance",
        project_id=project.id,
        stage_id=stage.id,
        requested_by=lead.id,
        requested_at=datetime(2026, 10, 12, 9),
        created_at=datetime(2026, 10, 12, 9),
        status="requested",
        checklist_json='[{"title":"Проверена гидроизоляция","done":true}]',
    )
    photo = StagePhoto(
        id="int-ver-photo",
        stage_id=stage.id,
        user_id=lead.id,
        caption="Фото после работ",
        storage_key="private/int-ver-project/secret.jpg",
        created_at=datetime(2026, 10, 12, 10),
    )
    db.add_all([owner, lead, outsider, project, stage, acceptance, photo])
    await db.commit()
    return owner, lead, outsider, project, stage, acceptance


@pytest.mark.asyncio
async def test_action_queue_requires_acceptance_before_verifiable_execution(db, monkeypatch):
    owner, _, _, project, stage, acceptance = await _seed(db)

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)
    monkeypatch.setattr(settings, "execution_proof_signing_private_key_b64", None)

    pending = await actions.build_action_responsibilities(db, project=project, actor=owner)
    responsibility = next(row for row in pending if row.resource_type == "acceptance")
    assert responsibility.resource_id == acceptance.id
    assert responsibility.action == "decide_work_acceptance"
    assert responsibility.responsible_user_id == owner.id

    with pytest.raises(records.ExecutionRecordNotAccepted):
        await records.get_verified_execution_record(
            db, project_id=project.id, stage_id=stage.id,
        )
    with pytest.raises(records.ExecutionRecordNotAccepted):
        await trust.issue_checkpoint(db, project_id=project.id, stage_id=stage.id)

    # Simulate the state *result* of canonical acceptance, not the mutation path;
    # its workflow/RBAC/outbox are tested by acceptance-decision-contracts.
    acceptance.status = "accepted"
    acceptance.accepted_at = datetime(2026, 10, 12, 12)
    acceptance.accepted_by = owner.id
    stage.status = StageStatus.done
    stage.customer_accepted_at = acceptance.accepted_at
    await db.commit()

    after = await actions.build_action_responsibilities(db, project=project, actor=owner)
    assert not any(
        row.resource_type == "acceptance" and row.resource_id == acceptance.id
        for row in after
    ), "accepted work must no longer ask the owner for the same decision"

    record = await records.get_verified_execution_record(
        db, project_id=project.id, stage_id=stage.id,
    )
    proof = await records.get_portable_execution_proof(
        db, project_id=project.id, stage_id=stage.id,
    )
    assert record["acceptance"]["acceptanceId"] == acceptance.id
    assert record["acceptance"]["status"] == "accepted"
    assert record["recordHashSha256"] == proof["sourceRecordHashSha256"]
    assert record["evidence"]["level"] == "E2"
    assert proof["evidence"]["level"] == "E2"
    assert proof["signature"]["status"] == "unsigned"
    assert proof["disclosureBoundary"]["photoStorageKeysIncluded"] is False
    assert "private/int-ver-project/secret.jpg" not in str(proof)
    assert owner.id not in str(proof)
    assert "int-ver-lead" not in str(proof)

    with pytest.raises(trust.ExecutionIssuerNotConfigured):
        await trust.issue_checkpoint(db, project_id=project.id, stage_id=stage.id)


@pytest.mark.asyncio
async def test_execution_record_denies_outsider_and_cross_project_stage(db):
    owner, _, outsider, project, stage, acceptance = await _seed(db)
    acceptance.status = "accepted"
    acceptance.accepted_at = datetime(2026, 10, 12, 12)
    acceptance.accepted_by = owner.id
    stage.status = StageStatus.done
    await db.commit()

    with pytest.raises(records.ExecutionRecordStageNotFound):
        await records.get_verified_execution_record(
            db, project_id="some-other-project", stage_id=stage.id,
        )

    async def current_user():
        return outsider

    async def current_db():
        yield db

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_db] = current_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/projects/{project.id}/stages/{stage.id}/verified-execution-record"
            )
            assert response.status_code in (403, 404), response.text
            assert "sourceRecordHashSha256" not in response.text
            assert "recordHashSha256" not in response.text
    finally:
        app.dependency_overrides.clear()
