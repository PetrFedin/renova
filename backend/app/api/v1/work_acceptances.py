"""Canonical API for work acceptance request, accept and return decisions."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, User, WorkAcceptance
from app.services import work_acceptance_decision_service as decisions

router = APIRouter(prefix="/projects", tags=["work-acceptances"])


class AcceptanceCreateIn(BaseModel):
    stage_id: str
    # Retained for wire compatibility. The canonical server-side stage checklist
    # remains the source of truth and this client list is never used to bypass it.
    checklist: list[str] | None = None
    comment: str | None = Field(default=None, max_length=2000)


class AcceptanceDecisionIn(BaseModel):
    # inline = hub list (quick only); full = stage fold with checklist
    mode: str | None = None
    checklist: list[str] | None = None
    quality_score: float | None = Field(default=None, ge=0, le=10)
    comment: str | None = Field(default=None, max_length=2000)
    create_issue: bool = False


def acceptance_dict(row: WorkAcceptance) -> dict:
    checklist: list = []
    if row.checklist_json:
        try:
            parsed = json.loads(row.checklist_json)
            checklist = parsed if isinstance(parsed, list) else []
        except (TypeError, ValueError):
            checklist = []
    return {
        "id": row.id,
        "project_id": row.project_id,
        "room_id": row.room_id,
        "stage_id": row.stage_id,
        "requested_by": row.requested_by,
        "accepted_by": row.accepted_by,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "status": row.status,
        "checklist": checklist,
        "quality_score": row.quality_score,
        "comment": row.comment,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def project_member_ids(project: Project) -> list[str]:
    from app.services.accept_orchestrator import project_member_ids as member_ids

    return member_ids(project)


# Compatibility exports used by older internal callers. All HTTP decisions below
# use work_acceptance_decision_service and cannot bypass the canonical lifecycle.
from app.services.accept_orchestrator import (  # noqa: E402,F401
    activate_next_stage,
    ensure_stage_payment,
)


def _decision_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {
        "stage_submit_actor_forbidden",
        "stage_reject_actor_forbidden",
        "acceptance_decision_customer_only",
    }:
        return HTTPException(
            403,
            detail={"code": code, "message": "Это действие недоступно вашей роли или назначению"},
        )
    if code in {"stage_rejection_reason_required", "stage_rejection_reason_too_long"}:
        return HTTPException(
            422,
            detail={"code": code, "message": "Укажите причину возврата этапа на доработку"},
        )
    if code == "photos_required":
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Добавьте хотя бы одно фото результата этапа перед приёмкой",
            },
        )
    if code in {"checklist_required", "checklist_incomplete"}:
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Откройте этап и отметьте чек-лист перед приёмкой",
            },
        )
    if code in {
        "acceptance_already_decided",
        "acceptance_not_current",
        "acceptance_state_inconsistent",
    } or code.startswith(("stage_submit_invalid_status:", "stage_reject_invalid_status:", "stage_accept_invalid_status:")):
        return HTTPException(
            409,
            detail={"code": code, "message": "Решение уже изменилось или переход недоступен"},
        )
    return HTTPException(
        409,
        detail={"code": code, "message": "Операция приёмки недоступна"},
    )


@router.get("/{project_id}/work-acceptances/pending-count")
async def acceptances_pending_count(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import acceptance_service

    await require_project(db, project_id, user, write=False)
    return {"count": await acceptance_service.pending_count(db, project_id)}


@router.get("/{project_id}/work-acceptances")
async def list_acceptances(
    project_id: str,
    stage_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    query = (
        select(WorkAcceptance)
        .where(WorkAcceptance.project_id == project_id)
        .order_by(WorkAcceptance.created_at.desc(), WorkAcceptance.id.desc())
    )
    if stage_id:
        query = query.where(WorkAcceptance.stage_id == stage_id)
    rows = list((await db.execute(query)).scalars().all())
    return [acceptance_dict(row) for row in rows]


@router.post("/{project_id}/work-acceptances")
async def request_acceptance(
    project_id: str,
    body: AcceptanceCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result, error = await decisions.request_acceptance(
            db,
            project=project,
            stage_id=body.stage_id,
            actor=user,
            comment=body.comment,
        )
    except ValueError as exc:
        raise _decision_error(exc) from exc
    if error:
        raise HTTPException(409, detail=error)
    if result is None:
        raise HTTPException(404, "stage_not_found")
    response = acceptance_dict(result.acceptance)
    response["replayed"] = result.replayed
    return response


@router.post("/{project_id}/work-acceptances/{acceptance_id}/accept")
async def accept_work(
    project_id: str,
    acceptance_id: str,
    body: AcceptanceDecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await decisions.accept_work(
            db,
            project=project,
            acceptance_id=acceptance_id,
            actor=user,
            comment=body.comment,
            quality_score=body.quality_score,
            create_issue=body.create_issue,
            checklist=body.checklist,
            source_mode=body.mode or "full",
        )
    except ValueError as exc:
        raise _decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")
    response = acceptance_dict(result.acceptance)
    response.update(
        {
            "replayed": result.replayed,
            "payment_id": result.payment_id,
            "next_stage_id": result.next_stage_id,
        }
    )
    return response


@router.post("/{project_id}/work-acceptances/{acceptance_id}/return")
async def return_work(
    project_id: str,
    acceptance_id: str,
    body: AcceptanceDecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await decisions.return_work(
            db,
            project=project,
            acceptance_id=acceptance_id,
            actor=user,
            comment=body.comment or "",
            quality_score=body.quality_score,
            create_issue=body.create_issue,
        )
    except ValueError as exc:
        raise _decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")
    response = acceptance_dict(result.acceptance)
    response.update(
        {
            "replayed": result.replayed,
            "issue_id": result.issue_id,
            "rework_deadline": (
                result.stage.rework_deadline.isoformat()
                if result.stage.rework_deadline
                else None
            ),
        }
    )
    return response
