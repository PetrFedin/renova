from datetime import datetime

import pytest

from app.models.entities import (
    ProjectIssue,
    Stage,
    StagePhoto,
    StageStatus,
    WorkAcceptance,
    WorkOrder,
    WorkOrderStatus,
)
from app.services.verified_execution_record_service import (
    ExecutionRecordNotAccepted,
    build_portable_execution_proof,
    build_verified_execution_record,
)


def _stage():
    return Stage(
        id="stage-1",
        project_id="project-1",
        name="Гидроизоляция",
        status=StageStatus.done,
        work_type="waterproofing",
        checklist_json='[{"title":"Основание подготовлено","done":true}]',
        needs_rework=False,
    )


def _acceptance(status="accepted"):
    return WorkAcceptance(
        id="accept-1",
        project_id="project-1",
        stage_id="stage-1",
        status=status,
        requested_at=datetime(2026, 10, 1, 10, 0, 0),
        accepted_at=datetime(2026, 10, 2, 12, 0, 0) if status.startswith("accepted") else None,
        requested_by="contractor-1",
        accepted_by="customer-1" if status.startswith("accepted") else None,
        checklist_json='[{"title":"Основание подготовлено","done":true}]',
    )


def test_verified_execution_record_is_deterministic_and_evidence_backed():
    stage = _stage()
    work = WorkOrder(
        id="work-1",
        project_id="project-1",
        stage_id="stage-1",
        work_type="waterproofing",
        title="Гидроизоляция санузла",
        status=WorkOrderStatus.done,
        created_at=datetime(2026, 10, 1, 9, 0, 0),
    )
    photo = StagePhoto(
        id="photo-1",
        stage_id="stage-1",
        user_id="contractor-1",
        caption="Готовый слой",
        storage_key="project/stage/photo.jpg",
        created_at=datetime(2026, 10, 2, 11, 0, 0),
    )
    issue = ProjectIssue(
        id="issue-1",
        project_id="project-1",
        stage_id="stage-1",
        title="Локальное замечание",
        severity="medium",
        status="closed",
        created_at=datetime(2026, 10, 2, 10, 0, 0),
        closed_at=datetime(2026, 10, 2, 11, 30, 0),
    )

    one = build_verified_execution_record(
        stage=stage,
        acceptance=_acceptance(),
        work_orders=[work],
        photos=[photo],
        issues=[issue],
    )
    two = build_verified_execution_record(
        stage=stage,
        acceptance=_acceptance(),
        work_orders=[work],
        photos=[photo],
        issues=[issue],
    )

    assert one["schemaVersion"] == "renova-verified-execution-record-v1"
    assert one["acceptance"]["status"] == "accepted"
    assert one["evidence"]["level"] == "E2"
    assert one["evidence"]["checklist"]["complete"] is True
    assert one["scope"][0]["workOrderId"] == "work-1"
    assert one["quality"]["defects"][0]["issueId"] == "issue-1"
    assert len(one["recordHashSha256"]) == 64
    assert one["recordHashSha256"] == two["recordHashSha256"]


def test_verified_execution_record_fails_closed_before_acceptance():
    with pytest.raises(ExecutionRecordNotAccepted):
        build_verified_execution_record(
            stage=_stage(),
            acceptance=_acceptance(status="requested"),
            work_orders=[],
            photos=[],
            issues=[],
        )


def test_portable_execution_proof_redacts_personal_and_storage_details():
    stage = _stage()
    work = WorkOrder(
        id="work-1",
        project_id="project-1",
        stage_id="stage-1",
        work_type="waterproofing",
        title="Гидроизоляция санузла",
        status=WorkOrderStatus.done,
        assignee_id="worker-private",
        created_at=datetime(2026, 10, 1, 9, 0, 0),
    )
    photo = StagePhoto(
        id="photo-1",
        stage_id="stage-1",
        user_id="contractor-private",
        caption="Готовый слой",
        storage_key="private/project/stage/photo.jpg",
        image_url="https://private.example/photo.jpg",
        created_at=datetime(2026, 10, 2, 11, 0, 0),
    )
    record = build_verified_execution_record(
        stage=stage,
        acceptance=_acceptance(),
        work_orders=[work],
        photos=[photo],
        issues=[],
    )
    proof = build_portable_execution_proof(record)

    assert proof["schemaVersion"] == "renova-portable-execution-proof-v1"
    assert proof["sourceRecordHashSha256"] == record["recordHashSha256"]
    assert proof["evidence"]["photoCount"] == 1
    assert proof["disclosureBoundary"]["userIdsIncluded"] is False
    assert proof["disclosureBoundary"]["photoStorageKeysIncluded"] is False
    assert proof["signature"]["status"] == "unsigned"
    assert len(proof["proofHashSha256"]) == 64
    assert "acceptedBy" not in proof["acceptance"]
    assert "assigneeId" not in proof["scope"][0]
    serialized = str(proof)
    assert "worker-private" not in serialized
    assert "contractor-private" not in serialized
    assert "private/project/stage/photo.jpg" not in serialized
