"""API приёмки работ: запрос → проверка → принять / вернуть."""
import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import (
    AcceptanceStatus,
    Payment,
    PaymentType,
    Project,
    ProjectIssue,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import activity_service as act
from app.services import notification_service as notif

router = APIRouter(prefix="/projects", tags=["work-acceptances"])


class AcceptanceCreateIn(BaseModel):
    stage_id: str
    checklist: list[str] | None = None
    comment: str | None = None


class AcceptanceDecisionIn(BaseModel):
    checklist: list[str] | None = None
    quality_score: float | None = Field(default=None, ge=0, le=10)
    comment: str | None = None
    create_issue: bool = False


def acceptance_dict(row: WorkAcceptance) -> dict:
    checklist: list[str] = []
    if row.checklist_json:
        try:
            checklist = json.loads(row.checklist_json)
        except Exception:
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
    from app.services.accept_orchestrator import project_member_ids as _pm

    return _pm(project)


def require_acceptance_requester(project: Project, user: User) -> None:
    is_assigned_contractor = user.role == UserRole.contractor and user.id in {project.contractor_id, project.foreman_id}
    if not is_assigned_contractor:
        raise HTTPException(403, "acceptance_request_contractor_only")


def require_acceptance_decider(project: Project, user: User) -> None:
    if user.role != UserRole.customer or user.id != project.customer_id:
        raise HTTPException(403, "acceptance_decision_customer_only")


def require_pending_decision(row: WorkAcceptance) -> None:
    if row.status not in {AcceptanceStatus.requested.value, AcceptanceStatus.in_review.value}:
        raise HTTPException(409, "acceptance_already_decided")


async def require_stage(db: AsyncSession, project_id: str, stage_id: str) -> Stage:
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "stage_not_found")
    return stage


async def active_acceptance(db: AsyncSession, project_id: str, stage_id: str) -> WorkAcceptance | None:
    return (
        await db.execute(
            select(WorkAcceptance)
            .where(WorkAcceptance.project_id == project_id)
            .where(WorkAcceptance.stage_id == stage_id)
            .where(WorkAcceptance.status.in_([
                AcceptanceStatus.requested.value,
                AcceptanceStatus.in_review.value,
            ]))
            .order_by(WorkAcceptance.created_at.desc())
            .limit(1)
        )
    ).scalars().first()


# Канон W44: helpers живут в accept_orchestrator (единый cascade)
from app.services.accept_orchestrator import (  # noqa: E402
    activate_next_stage,
    ensure_stage_payment,
)


@router.get("/{project_id}/work-acceptances/pending-count")
async def acceptances_pending_count(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import acceptance_service as acc_svc

    await require_project(db, project_id, user, write=False)
    return {"count": await acc_svc.pending_count(db, project_id)}


@router.get("/{project_id}/work-acceptances")
async def list_acceptances(
    project_id: str,
    stage_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    query = select(WorkAcceptance).where(WorkAcceptance.project_id == project_id).order_by(WorkAcceptance.created_at.desc())
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
    require_acceptance_requester(project, user)
    stage = await require_stage(db, project_id, body.stage_id)
    if stage.status == StageStatus.done:
        raise HTTPException(409, "stage_already_accepted")
    existing = await active_acceptance(db, project_id, body.stage_id)
    if existing:
        return acceptance_dict(existing)

    row = WorkAcceptance(
        project_id=project_id,
        room_id=None,
        stage_id=stage.id,
        requested_by=user.id,
        requested_at=datetime.utcnow(),
        status=AcceptanceStatus.requested.value,
        checklist_json=json.dumps(body.checklist or []),
        comment=body.comment,
        created_at=datetime.utcnow(),
    )
    stage.status = StageStatus.review
    stage.contractor_ready = True
    stage.contractor_ready_at = stage.contractor_ready_at or datetime.utcnow()
    stage.percent_complete = max(stage.percent_complete or 0, 90)
    db.add(row)
    await db.commit()
    await db.refresh(row)

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="AcceptanceRequested",
        title=f"Этап на приёмке: {stage.name}",
        body=body.comment,
        link_path=f"/stage/{stage.id}",
    )
    for member_id in project_member_ids(project):
        if member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type="stage_review",
            title=f"Этап ждёт приёмки: {stage.name}",
            body=body.comment or "Проверьте результат работ и примите решение.",
            link_path=f"/stage/{stage.id}",
            return_to="/(customer)/(tabs)/home",
        )
    return acceptance_dict(row)


@router.post("/{project_id}/work-acceptances/{acceptance_id}/accept")
async def accept_work(
    project_id: str,
    acceptance_id: str,
    body: AcceptanceDecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.accept_orchestrator import emit_acceptance_side_effects, finalize_work_acceptance

    project = await require_project(db, project_id, user, write=True)
    require_acceptance_decider(project, user)
    row = await db.get(WorkAcceptance, acceptance_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "acceptance_not_found")
    require_pending_decision(row)
    stage = await require_stage(db, project_id, row.stage_id)

    result = await finalize_work_acceptance(
        db,
        project=project,
        stage=stage,
        row=row,
        accepted_by=user.id,
        comment=body.comment,
        quality_score=body.quality_score,
        create_issue=body.create_issue,
        checklist=body.checklist,
    )
    await db.commit()
    await db.refresh(result.acceptance)

    await emit_acceptance_side_effects(
        db,
        project=project,
        stage=result.stage,
        accepted_by=user.id,
        comment=body.comment,
        payment=result.payment,
        next_stage=result.next_stage,
        source="app",
    )
    return acceptance_dict(result.acceptance)


@router.post("/{project_id}/work-acceptances/{acceptance_id}/return")
async def return_work(
    project_id: str,
    acceptance_id: str,
    body: AcceptanceDecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    require_acceptance_decider(project, user)
    row = await db.get(WorkAcceptance, acceptance_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "acceptance_not_found")
    require_pending_decision(row)
    stage = await require_stage(db, project_id, row.stage_id)

    row.status = AcceptanceStatus.returned.value
    row.accepted_by = user.id
    row.quality_score = body.quality_score
    row.comment = body.comment or row.comment
    if body.checklist is not None:
        row.checklist_json = json.dumps(body.checklist)
    stage.status = StageStatus.active
    stage.contractor_ready = False
    stage.contractor_ready_at = None
    stage.needs_rework = True
    stage.percent_complete = min(stage.percent_complete or 90, 90)

    if body.create_issue:
        db.add(ProjectIssue(
            project_id=project_id,
            stage_id=stage.id,
            title=f"Доработка по этапу: {stage.name}",
            description=body.comment,
            severity="medium",
            status="open",
            created_at=datetime.utcnow(),
        ))
    await db.commit()
    await db.refresh(row)

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="AcceptanceReturned",
        title=f"Этап возвращён на доработку: {stage.name}",
        body=body.comment,
        link_path=f"/stage/{stage.id}",
    )
    for member_id in project_member_ids(project):
        if member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type="stage_review",
            title=f"Доработка по этапу: {stage.name}",
            body=body.comment or "Этап возвращён после проверки.",
            link_path=f"/stage/{stage.id}",
            return_to="/(customer)/(tabs)/home",
        )
    return acceptance_dict(row)
