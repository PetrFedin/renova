"""Приёмка этапов Renova OS — отдельный процесс с quality score."""
from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Stage, WorkAcceptance
from app.services import workflow_service as wf


def _parse_checklist(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def compute_quality_score(stage: Stage, open_issues: int = 0, returned_before: bool = False) -> float:
    items = _parse_checklist(stage.checklist_json)
    if items:
        done = sum(1 for i in items if i.get("done"))
        base = (done / len(items)) * 100
    else:
        base = 85.0 if stage.contractor_ready else 60.0
    penalty = min(open_issues * 8, 32)
    if returned_before:
        penalty += 12
    if stage.needs_rework:
        penalty += 15
    return round(max(0.0, min(100.0, base - penalty)), 1)


def acceptance_dict(a: WorkAcceptance, stage: Stage | None = None) -> dict:
    checklist = _parse_checklist(a.checklist_json or (stage.checklist_json if stage else None))
    done = sum(1 for i in checklist if i.get("done"))
    total = len(checklist)
    return {
        "id": a.id,
        "project_id": a.project_id,
        "room_id": a.room_id,
        "stage_id": a.stage_id,
        "stage_name": stage.name if stage else None,
        "status": a.status,
        "requested_at": a.requested_at.isoformat() if a.requested_at else None,
        "accepted_at": a.accepted_at.isoformat() if a.accepted_at else None,
        "quality_score": a.quality_score,
        "comment": a.comment,
        "checklist": checklist,
        "checklist_progress": {"done": done, "total": total},
    }


async def get_by_stage(db: AsyncSession, stage_id: str) -> WorkAcceptance | None:
    r = await db.execute(
        select(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id).order_by(WorkAcceptance.created_at.desc())
    )
    return r.scalars().first()


async def request_acceptance(db: AsyncSession, stage: Stage, *, requested_by: str | None = None, room_id: str | None = None) -> WorkAcceptance:
    acc = await get_by_stage(db, stage.id)
    await wf.ensure_stage_checklist(db, stage)
    checklist_json = stage.checklist_json
    if acc:
        acc.status = "requested"
        acc.requested_at = datetime.utcnow()
        acc.requested_by = requested_by
        acc.checklist_json = checklist_json
        acc.quality_score = None
        acc.comment = None
        acc.accepted_at = None
        acc.accepted_by = None
    else:
        acc = WorkAcceptance(
            project_id=stage.project_id,
            room_id=room_id,
            stage_id=stage.id,
            requested_by=requested_by,
            requested_at=datetime.utcnow(),
            status="requested",
            checklist_json=checklist_json,
        )
        db.add(acc)
    await db.flush()
    return acc


async def mark_in_review(db: AsyncSession, acceptance_id: str) -> WorkAcceptance | None:
    acc = await db.get(WorkAcceptance, acceptance_id)
    if not acc or acc.status not in ("requested", "in_review"):
        return None
    acc.status = "in_review"
    await db.flush()
    return acc


async def accept(db: AsyncSession, acceptance_id: str, *, accepted_by: str, with_remarks: bool = False, comment: str | None = None, open_issues: int = 0) -> WorkAcceptance | None:
    acc = await db.get(WorkAcceptance, acceptance_id)
    if not acc:
        return None
    stage = await db.get(Stage, acc.stage_id)
    if not stage:
        return None
    returned_before = acc.status == "returned"
    acc.status = "accepted_with_remarks" if with_remarks else "accepted"
    acc.accepted_by = accepted_by
    acc.accepted_at = datetime.utcnow()
    acc.comment = comment
    acc.quality_score = compute_quality_score(stage, open_issues=open_issues, returned_before=returned_before)
    await db.flush()
    return acc


async def return_for_rework(db: AsyncSession, acceptance_id: str, *, comment: str | None = None) -> WorkAcceptance | None:
    acc = await db.get(WorkAcceptance, acceptance_id)
    if not acc:
        return None
    acc.status = "returned"
    acc.comment = comment
    acc.accepted_at = None
    acc.accepted_by = None
    acc.quality_score = None
    await db.flush()
    return acc


async def list_acceptances(db: AsyncSession, project_id: str, *, status: str | None = None) -> list[tuple[WorkAcceptance, Stage]]:
    q = select(WorkAcceptance, Stage).join(Stage, Stage.id == WorkAcceptance.stage_id).where(WorkAcceptance.project_id == project_id)
    if status:
        q = q.where(WorkAcceptance.status == status)
    q = q.order_by(WorkAcceptance.requested_at.desc().nullslast())
    return [(a, s) for a, s in (await db.execute(q)).all()]


async def pending_count(db: AsyncSession, project_id: str) -> int:
    """Единый счётчик: pending acceptances + этапы в review без записи приёмки."""
    from app.models.entities import Stage, StageStatus
    accs = (await db.execute(
        select(WorkAcceptance).where(
            WorkAcceptance.project_id == project_id,
            WorkAcceptance.status.in_(("requested", "in_review")),
        )
    )).scalars().all()
    covered = {a.stage_id for a in accs}
    review_ids = (await db.execute(
        select(Stage.id).where(Stage.project_id == project_id, Stage.status == StageStatus.review)
    )).scalars().all()
    orphan = sum(1 for sid in review_ids if sid not in covered)
    return len(accs) + orphan
