"""Web client portal — magic link + read-only snapshot (P2.1)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import portal_token_service as portal_tok
from app.services import team_service as team_svc

router = APIRouter(tags=["portal"])


class PortalSessionIn(BaseModel):
    token: str


class PortalLinkCreate(BaseModel):
    allow_accept_stage: bool = False


class PortalLinkOut(BaseModel):
    token: str
    url: str
    expires_hours: int = 168


@router.post("/auth/portal/session")
async def portal_session(body: PortalSessionIn, db: AsyncSession = Depends(get_db)):
    """Обмен magic link JWT → user_id + project (без пароля; гость должен быть в project_viewers)."""
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")

    from sqlalchemy import select

    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "user_not_found")
    project = await db.get(Project, claims["project_id"])
    if not project:
        raise HTTPException(404, "project_not_found")

    mode, read_only = await team_svc.project_access_mode(db, user, project)
    if mode == "none":
        raise HTTPException(403, "no_access")
    if claims["project_id"] != project.id or claims["user_id"] != user.id:
        raise HTTPException(401, "token_mismatch")

    return {
        "user_id": user.id,
        "project_id": project.id,
        "project_name": project.name,
        "read_only": bool(claims.get("read_only", read_only)),
        "access_mode": mode,
        "role": user.role.value,
        "scopes": claims.get("scopes", ["read"]),
    }


@router.post("/projects/{project_id}/viewers/{viewer_user_id}/portal-link", response_model=PortalLinkOut)
async def create_viewer_portal_link(
    project_id: str,
    viewer_user_id: str,
    body: PortalLinkCreate = PortalLinkCreate(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заказчик: magic link для гостя (read-only web portal)."""
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")

    from sqlalchemy import select
    from app.models.entities import ProjectViewer

    row = (
        await db.execute(
            select(ProjectViewer).where(
                ProjectViewer.project_id == project_id,
                ProjectViewer.user_id == viewer_user_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "viewer_not_found")

    guest = await db.get(User, viewer_user_id)
    if not guest:
        raise HTTPException(404, "viewer_not_found")

    scopes = ["read"]
    if body.allow_accept_stage:
        if guest.id != p.customer_id:
            raise HTTPException(403, "accept_stage_only_for_customer")
        scopes = ["read", "accept_stage", "sign_document"]
    token = portal_tok.create_portal_token(project_id=project_id, user_id=viewer_user_id, scopes=scopes)
    return PortalLinkOut(token=token, url=portal_tok.portal_url(token))




@router.post("/projects/{project_id}/portal-link", response_model=PortalLinkOut)
async def create_customer_portal_link(
    project_id: str,
    body: PortalLinkCreate = PortalLinkCreate(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заказчик: magic link для себя (web portal, опционально приёмка этапа)."""
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")
    scopes = ["read"]
    if body.allow_accept_stage:
        scopes.extend(["accept_stage", "sign_document"])
    token = portal_tok.create_portal_token(project_id=project_id, user_id=user.id, scopes=scopes)
    return PortalLinkOut(token=token, url=portal_tok.portal_url(token))


@router.get("/portal/projects/{project_id}/snapshot")
async def portal_snapshot(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only сводка для web portal: расписание, документы, оплаты."""
    p = await require_project(db, project_id, user, write=False)
    mode, read_only = await team_svc.project_access_mode(db, user, p)

    from app.services import schedule_service as sched
    from app.services import payment_service as pay_svc
    from app.models.entities import WorkAcceptance, AcceptanceStatus, Stage
    from app.services import project_document_service as docs_svc
    from sqlalchemy import select
    from app.models.entities import SelectionItem
    from app.api.v1.selections import _out as selection_out

    schedule = await sched.build_schedule_summary(db, p)
    payments = await pay_svc.list_payments(db, project_id)
    pending = [pay_svc.payment_dict(x) for x in payments if x.status.value == "pending"]
    canonical = await docs_svc.list_canonical_documents(db, project_id)
    sel_rows = (
        await db.execute(
            select(SelectionItem).where(SelectionItem.project_id == project_id).order_by(SelectionItem.created_at.desc())
        )
    ).scalars().all()
    selections = [selection_out(r) for r in sel_rows[:15]]
    pending_acc_rows = (
        await db.execute(
            select(WorkAcceptance).where(
                WorkAcceptance.project_id == project_id,
                WorkAcceptance.status.in_((AcceptanceStatus.requested.value, AcceptanceStatus.in_review.value)),
            ).order_by(WorkAcceptance.requested_at.desc())
        )
    ).scalars().all()
    pending_acceptances = []
    for row in pending_acc_rows[:5]:
        stage = await db.get(Stage, row.stage_id)
        pending_acceptances.append({
            "id": row.id,
            "stage_id": row.stage_id,
            "stage_name": stage.name if stage else None,
            "status": row.status,
            "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        })

    recipient_name = None
    payment_requisites = None
    if p.contractor_id:
        from app.models.entities import ContractorProfile
        contractor = await db.get(User, p.contractor_id)
        if contractor:
            recipient_name = contractor.full_name
        cprof = (
            await db.execute(
                select(ContractorProfile).where(ContractorProfile.user_id == p.contractor_id)
            )
        ).scalar_one_or_none()
        if cprof:
            payment_requisites = cprof.payment_requisites
            if cprof.company_name:
                recipient_name = cprof.company_name

    return {
        "project": {"id": p.id, "name": p.name, "address": p.address, "progress_percent": p.progress_percent},
        "read_only": read_only,
        "access_mode": mode,
        "schedule": schedule,
        "pending_payments": pending,
        "contractor_recipient_name": recipient_name,
        "contractor_payment_requisites": payment_requisites,
        "documents": canonical[:20],
        "documents_total": len(canonical),
        "selections": selections,
        "selections_total": len(sel_rows),
        "pending_acceptances": pending_acceptances,
        "can_accept_stage": user.id == p.customer_id and user.role == UserRole.customer,
        "can_sign_documents": user.id == p.customer_id and user.role == UserRole.customer,
        "pending_draft_documents": [d for d in canonical if d.get("status") == "draft"],
    }

class PortalAcceptIn(BaseModel):
    token: str
    comment: str | None = None


@router.post("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/accept")
async def portal_accept_work(
    project_id: str,
    acceptance_id: str,
    body: PortalAcceptIn,
    db: AsyncSession = Depends(get_db),
):
    """P3.2a: приёмка этапа по magic link (scope accept_stage, только заказчик)."""
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims["project_id"] != project_id:
        raise HTTPException(401, "token_mismatch")
    if "accept_stage" not in claims.get("scopes", []):
        raise HTTPException(403, "portal_read_only")

    from sqlalchemy import select
    from datetime import datetime, date
    from app.models.entities import WorkAcceptance, AcceptanceStatus, Stage, StageStatus, ProjectIssue
    from app.api.v1.work_acceptances import (
        acceptance_dict,
        require_pending_decision,
        require_stage,
        ensure_stage_payment,
        activate_next_stage,
    )
    from app.services import activity_service as act

    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "user_not_found")
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project_not_found")
    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "acceptance_decision_customer_only")

    row = await db.get(WorkAcceptance, acceptance_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "acceptance_not_found")
    require_pending_decision(row)
    stage = await require_stage(db, project_id, row.stage_id)

    now = datetime.utcnow()
    row.status = AcceptanceStatus.accepted.value
    row.accepted_by = user.id
    row.accepted_at = now
    row.comment = body.comment or row.comment
    stage.status = StageStatus.done
    stage.customer_accepted_at = stage.customer_accepted_at or now
    stage.actual_end = stage.actual_end or date.today()
    stage.percent_complete = 100
    stage.needs_rework = False

    await ensure_stage_payment(db, project, stage, user.id)
    await activate_next_stage(db, stage)

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="AcceptanceAccepted",
        title=f"Этап принят (портал): {stage.name}",
        body=body.comment,
        link_path=f"/stage/{stage.id}",
    )
    await db.commit()
    await db.refresh(row)
    return acceptance_dict(row)


class PortalSignIn(BaseModel):
    token: str
    provider: str = "in_app"


@router.post("/portal/projects/{project_id}/documents/{document_id}/sign")
async def portal_sign_document(
    project_id: str,
    document_id: str,
    body: PortalSignIn,
    db: AsyncSession = Depends(get_db),
):
    """P3-W6: in-app подпись черновика по magic link (scope sign_document, заказчик)."""
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims["project_id"] != project_id:
        raise HTTPException(401, "token_mismatch")
    if "sign_document" not in claims.get("scopes", []):
        raise HTTPException(403, "portal_read_only")

    from app.models.project_documents import DocumentStatus
    from app.services import project_document_service as docs_svc
    from app.services import activity_service as act

    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "user_not_found")
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project_not_found")
    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "sign_customer_only")

    doc = await db.get(__import__('app.models.project_documents', fromlist=['ProjectDocument']).ProjectDocument, document_id)
    if not doc or doc.project_id != project_id or doc.status == DocumentStatus.deleted.value:
        raise HTTPException(404, "document_not_found")
    if doc.status not in (DocumentStatus.draft.value, DocumentStatus.active.value):
        raise HTTPException(400, "document_not_signable")

    try:
        sig = await docs_svc.sign_document(
            db,
            doc,
            signer_user_id=user.id,
            signer_role=user.role.value,
            signature_type=body.provider,
            provider=body.provider,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    if doc.status == DocumentStatus.draft.value:
        doc.status = DocumentStatus.active.value

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="DocumentSigned",
        title=f"Подписан (портал): {doc.title}",
        body=body.provider,
        link_path="/documents",
    )
    import json
    meta = {}
    if sig.meta_json:
        try:
            meta = json.loads(sig.meta_json)
        except Exception:
            meta = {}
    await db.commit()
    return {"ok": True, "signature_id": sig.id, "status": sig.status, "signing_url": meta.get("signing_url")}
