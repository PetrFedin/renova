"""Evidence-backed Verified Execution Record v1.

The record is a deterministic projection over canonical Renova facts. It is not
an editable certificate and exists only after a canonical work acceptance has
reached an accepted state.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ProjectIssue, Stage, StagePhoto, WorkAcceptance, WorkOrder


ACCEPTED_STATUSES = {"accepted", "accepted_with_remarks"}
SCHEMA_VERSION = "renova-verified-execution-record-v1"
WARRANTY_PREFIX = "[Гарантия]"


class ExecutionRecordNotAccepted(ValueError):
    code = "execution_record_not_accepted"


class ExecutionRecordStageNotFound(LookupError):
    code = "execution_record_stage_not_found"


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return str(getattr(value, "value", value))


def _parse_checklist(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _canonical_hash(payload: dict[str, Any]) -> str:
    material = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _evidence_level(*, photos: int, checklist_total: int, checklist_done: int) -> str:
    # E0-E2 are implemented. E3/E4 are intentionally not claimed until
    # quantity/geometry and passport/warranty linkage become canonical inputs.
    if photos > 0 and checklist_total > 0 and checklist_done == checklist_total:
        return "E2"
    if photos > 0:
        return "E1"
    return "E0"


def build_verified_execution_record(
    *,
    stage: Stage,
    acceptance: WorkAcceptance,
    work_orders: list[WorkOrder],
    photos: list[StagePhoto],
    issues: list[ProjectIssue],
) -> dict[str, Any]:
    status = _enum_value(acceptance.status)
    if status not in ACCEPTED_STATUSES or acceptance.accepted_at is None:
        raise ExecutionRecordNotAccepted("execution_record_not_accepted")

    checklist = _parse_checklist(acceptance.checklist_json or stage.checklist_json)
    checklist_done = sum(1 for item in checklist if bool(item.get("done")))
    warranties = [item for item in issues if str(item.title or "").startswith(WARRANTY_PREFIX)]
    defects = [item for item in issues if item not in warranties]

    subject = {
        "projectId": stage.project_id,
        "stageId": stage.id,
        "stageName": stage.name,
        "workType": stage.work_type,
        "roomIdsJson": stage.room_ids_json,
    }
    acceptance_fact = {
        "acceptanceId": acceptance.id,
        "status": status,
        "requestedAt": _iso(acceptance.requested_at),
        "acceptedAt": _iso(acceptance.accepted_at),
        "requestedBy": acceptance.requested_by,
        "acceptedBy": acceptance.accepted_by,
        "comment": acceptance.comment,
        "qualityScore": acceptance.quality_score,
    }
    scope = [
        {
            "workOrderId": row.id,
            "workType": row.work_type,
            "title": row.title,
            "status": _enum_value(row.status),
            "roomId": row.room_id,
            "plannedStart": _iso(row.planned_start),
            "plannedEnd": _iso(row.planned_end),
            "actualStart": _iso(row.actual_start),
            "actualEnd": _iso(row.actual_end),
            "assigneeId": row.assignee_id,
        }
        for row in sorted(work_orders, key=lambda row: (row.created_at, row.id))
    ]
    evidence = {
        "level": _evidence_level(
            photos=len(photos),
            checklist_total=len(checklist),
            checklist_done=checklist_done,
        ),
        "checklist": {
            "total": len(checklist),
            "done": checklist_done,
            "complete": bool(checklist) and checklist_done == len(checklist),
            "items": checklist,
        },
        "photos": [
            {
                "photoId": row.id,
                "caption": row.caption,
                "storageKey": row.storage_key,
                "imageUrl": row.image_url,
                "createdAt": _iso(row.created_at),
                "userId": row.user_id,
            }
            for row in sorted(photos, key=lambda row: (row.created_at, row.id))
        ],
    }
    quality = {
        "needsRework": bool(stage.needs_rework),
        "defects": [
            {
                "issueId": row.id,
                "title": row.title,
                "severity": row.severity,
                "status": row.status,
                "createdAt": _iso(row.created_at),
                "closedAt": _iso(row.closed_at),
            }
            for row in sorted(defects, key=lambda row: (row.created_at, row.id))
        ],
        "warranty": [
            {
                "issueId": row.id,
                "title": row.title,
                "status": row.status,
                "createdAt": _iso(row.created_at),
                "closedAt": _iso(row.closed_at),
            }
            for row in sorted(warranties, key=lambda row: (row.created_at, row.id))
        ],
    }

    canonical = {
        "schemaVersion": SCHEMA_VERSION,
        "subject": subject,
        "acceptance": acceptance_fact,
        "scope": scope,
        "evidence": evidence,
        "quality": quality,
        "lineage": {
            "acceptanceTable": "work_acceptances",
            "stageTable": "stages",
            "scopeTable": "work_orders",
            "photoTable": "stage_photos",
            "issueTable": "project_issues",
        },
    }
    return {**canonical, "recordHashSha256": _canonical_hash(canonical)}


def build_portable_execution_proof(record: dict[str, Any]) -> dict[str, Any]:
    canonical = {
        "schemaVersion": "renova-portable-execution-proof-v1",
        "subject": {
            "projectId": record["subject"]["projectId"],
            "stageId": record["subject"]["stageId"],
            "stageName": record["subject"]["stageName"],
            "workType": record["subject"]["workType"],
        },
        "acceptance": {
            "acceptanceId": record["acceptance"]["acceptanceId"],
            "status": record["acceptance"]["status"],
            "acceptedAt": record["acceptance"]["acceptedAt"],
            "qualityScore": record["acceptance"]["qualityScore"],
        },
        "scope": [
            {
                "workOrderId": row["workOrderId"],
                "workType": row["workType"],
                "title": row["title"],
                "status": row["status"],
                "actualStart": row["actualStart"],
                "actualEnd": row["actualEnd"],
            }
            for row in record["scope"]
        ],
        "evidence": {
            "level": record["evidence"]["level"],
            "checklist": {
                "total": record["evidence"]["checklist"]["total"],
                "done": record["evidence"]["checklist"]["done"],
                "complete": record["evidence"]["checklist"]["complete"],
            },
            "photoCount": len(record["evidence"]["photos"]),
        },
        "quality": {
            "needsRework": record["quality"]["needsRework"],
            "defectCount": len(record["quality"]["defects"]),
            "warrantyCount": len(record["quality"]["warranty"]),
        },
        "sourceRecordHashSha256": record["recordHashSha256"],
        "disclosureBoundary": {
            "userIdsIncluded": False,
            "assigneeIdsIncluded": False,
            "photoStorageKeysIncluded": False,
            "photoUrlsIncluded": False,
            "commentsIncluded": False,
            "financialDataIncluded": False,
        },
        "signature": {"status": "unsigned", "issuer": None},
    }
    return {**canonical, "proofHashSha256": _canonical_hash(canonical)}


async def get_portable_execution_proof(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> dict[str, Any]:
    record = await get_verified_execution_record(db, project_id=project_id, stage_id=stage_id)
    return build_portable_execution_proof(record)


async def get_verified_execution_record(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> dict[str, Any]:
    stage = await db.get(Stage, stage_id)
    if stage is None or stage.project_id != project_id:
        raise ExecutionRecordStageNotFound(stage_id)

    acceptance = (
        await db.execute(
            select(WorkAcceptance)
            .where(
                WorkAcceptance.project_id == project_id,
                WorkAcceptance.stage_id == stage_id,
                WorkAcceptance.status.in_(tuple(ACCEPTED_STATUSES)),
                WorkAcceptance.accepted_at.is_not(None),
            )
            .order_by(WorkAcceptance.accepted_at.desc(), WorkAcceptance.created_at.desc(), WorkAcceptance.id.desc())
            .limit(1)
        )
    ).scalars().first()
    if acceptance is None:
        raise ExecutionRecordNotAccepted(stage_id)

    work_orders = list(
        (
            await db.execute(
                select(WorkOrder)
                .where(WorkOrder.project_id == project_id, WorkOrder.stage_id == stage_id)
                .order_by(WorkOrder.created_at, WorkOrder.id)
            )
        ).scalars().all()
    )
    photos = list(
        (
            await db.execute(
                select(StagePhoto)
                .where(StagePhoto.stage_id == stage_id)
                .order_by(StagePhoto.created_at, StagePhoto.id)
            )
        ).scalars().all()
    )
    issues = list(
        (
            await db.execute(
                select(ProjectIssue)
                .where(ProjectIssue.project_id == project_id, ProjectIssue.stage_id == stage_id)
                .order_by(ProjectIssue.created_at, ProjectIssue.id)
            )
        ).scalars().all()
    )
    return build_verified_execution_record(
        stage=stage,
        acceptance=acceptance,
        work_orders=work_orders,
        photos=photos,
        issues=issues,
    )
