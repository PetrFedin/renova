"""Web client portal — magic link + read-only snapshot (P2.1)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import portal_token_service as portal_tok
from app.services import team_service as team_svc

router = APIRouter(tags=["portal"])


class PortalSessionIn(BaseModel):
    token: str


class PortalLinkCreate(BaseModel):
    allow_accept_stage: bool = False
    # Явное право оплаты по magic-link (не выводить из pending_payments на клиенте)
    allow_pay: bool = False


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

    # P0: portal snapshot/API need Bearer — magic link alone must mint access JWT
    access_token = create_access_token(
        user.id,
        {
            "role": user.role.value,
            "portal": True,
            "project_id": project.id,
        },
    )
    return {
        "user_id": user.id,
        "project_id": project.id,
        "project_name": project.name,
        "read_only": bool(claims.get("read_only", read_only)),
        "access_mode": mode,
        "role": user.role.value,
        "scopes": claims.get("scopes", ["read"]),
        "access_token": access_token,
        "token_type": "bearer",
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
    if body.allow_pay:
        if guest.id != p.customer_id:
            raise HTTPException(403, "pay_only_for_customer")
        if "pay" not in scopes:
            scopes.append("pay")
    token = portal_tok.create_portal_token(project_id=project_id, user_id=viewer_user_id, scopes=scopes)
    return PortalLinkOut(token=token, url=portal_tok.portal_url(token))




@router.post("/projects/{project_id}/portal-link", response_model=PortalLinkOut)
async def create_customer_portal_link(
    project_id: str,
    body: PortalLinkCreate = PortalLinkCreate(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W122: magic link клиентского портала (Houzz/BT).

    Заказчик — для себя; исполнитель объекта — для customer_id (шаринг ЛК).
    """
    proj = await require_project(db, project_id, user, write=True)
    if user.id == proj.customer_id:
        target_user_id = user.id
    elif proj.contractor_id and user.id == proj.contractor_id:
        if not proj.customer_id:
            raise HTTPException(400, "no_customer_on_project")
        target_user_id = proj.customer_id
    else:
        raise HTTPException(403, "portal_link_customer_or_contractor_only")
    scopes = ["read"]
    if body.allow_accept_stage:
        scopes.extend(["accept_stage", "sign_document"])
    if body.allow_pay and "pay" not in scopes:
        scopes.append("pay")
    token = portal_tok.create_portal_token(
        project_id=project_id, user_id=target_user_id, scopes=scopes
    )
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

    # W57: submitted work-schedule for portal confirm honesty
    pending_work_schedule = None
    try:
        from app.services import project_work_schedule_service as wss
        active = await wss.get_active_schedule(db, p)
        st = getattr(active.status, "value", None) if active else None
        if active and st == "submitted":
            pending_work_schedule = {"id": active.id, "title": active.title, "status": "submitted"}
    except Exception:
        pending_work_schedule = None
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
    from datetime import datetime as _dt
    for row in pending_acc_rows[:5]:
        stage = await db.get(Stage, row.stage_id)
        hours_waiting = None
        if row.requested_at:
            hours_waiting = round((_dt.utcnow() - row.requested_at).total_seconds() / 3600, 1)
        pending_acceptances.append({
            "id": row.id,
            "stage_id": row.stage_id,
            "stage_name": stage.name if stage else None,
            "status": row.status,
            "requested_at": row.requested_at.isoformat() if row.requested_at else None,
            "hours_waiting": hours_waiting,  # W68 #45 SLA
        })

    # W68 #47: смета read-only в portal
    from app.models.entities import EstimateLine
    est_lines = list(
        (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    )
    est_total = round(sum(float(l.quantity_planned or 0) * float(l.unit_price or 0) for l in est_lines), 2)
    estimate_summary = {
        "lines_count": len(est_lines),
        "total": est_total,
        "locked_at": p.estimate_locked_at.isoformat() if p.estimate_locked_at else None,
        "proposed_at": p.estimate_lock_proposed_at.isoformat() if p.estimate_lock_proposed_at else None,
        "lines": [
            {
                "name": l.name,
                "unit": l.unit,
                "qty": l.quantity_planned,
                "price": l.unit_price,
                "total": round(float(l.quantity_planned or 0) * float(l.unit_price or 0), 2),
            }
            for l in est_lines[:30]
        ],
    }

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

    # W47/W55: live | requisites | demo | off (off когда staging без ключей и без demo)
    try:
        from app.services.yookassa_service import yookassa_health, demo_allowed
        yh = yookassa_health()
        pay_live = bool(yh.get("live_checkout_ready"))
        allow_demo = bool(demo_allowed())
    except Exception:
        pay_live = False
        allow_demo = False
    if pay_live:
        payments_mode = "live"
    elif payment_requisites:
        payments_mode = "requisites"
    elif allow_demo:
        payments_mode = "demo"
    else:
        payments_mode = "off"

    # Portal lite: согласование доп. работ (без чата)
    from app.models.entities import ChangeOrder, ChangeOrderStatus
    co_rows = (
        await db.execute(
            select(ChangeOrder).where(
                ChangeOrder.project_id == project_id,
                ChangeOrder.status == ChangeOrderStatus.pending,
            ).order_by(ChangeOrder.created_at.desc())
        )
    ).scalars().all()
    pending_change_orders = [
        {"id": c.id, "title": c.title, "amount": c.amount, "description": c.description, "status": c.status.value}
        for c in co_rows[:10]
    ]
    can_decide_co = user.id == p.customer_id and user.role == UserRole.customer and not read_only

    return {
        "project": {"id": p.id, "name": p.name, "address": p.address, "progress_percent": p.progress_percent},
        "read_only": read_only,
        "access_mode": mode,
        "schedule": schedule,
        "pending_work_schedule": pending_work_schedule,
        "pending_payments": pending,
        "contractor_recipient_name": recipient_name,
        "contractor_company_name": recipient_name,
        "contractor_payment_requisites": payment_requisites,
        "payments_mode": payments_mode,
        "documents": canonical[:20],
        "documents_total": len(canonical),
        "selections": selections,
        "selections_total": len(sel_rows),
        "pending_acceptances": pending_acceptances,
        "estimate_summary": estimate_summary,
        "pending_change_orders": pending_change_orders,
        "can_decide_change_orders": can_decide_co,
        "can_accept_stage": user.id == p.customer_id and user.role == UserRole.customer,
        "can_confirm_schedule": user.id == p.customer_id and user.role == UserRole.customer and not read_only,
        "can_sign_documents": user.id == p.customer_id and user.role == UserRole.customer,
        # W75: черновик на подпись — без уже подписанных (webhook → signed_at)
        "pending_draft_documents": [
            d for d in canonical
            if d.get("status") == "draft"
            and not any(
                (s.get("status") == "signed" and s.get("signed_at"))
                for s in ((d.get("meta") or {}).get("signatures") or [])
            )
        ],
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

    from app.models.entities import WorkAcceptance
    from app.api.v1.work_acceptances import (
        acceptance_dict,
        require_pending_decision,
        require_stage,
    )
    from app.services.accept_orchestrator import emit_acceptance_side_effects, finalize_work_acceptance

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

    try:
        result = await finalize_work_acceptance(
            db,
            project=project,
            stage=stage,
            row=row,
            accepted_by=user.id,
            comment=body.comment,
        )
    except ValueError as exc:
        if str(exc) == "photos_required":
            raise HTTPException(
                409,
                detail={
                    "code": "photos_required",
                    "message": "Добавьте хотя бы одно фото результата этапа перед приёмкой",
                },
            ) from exc
        raise
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
        source="portal",
    )
    return acceptance_dict(result.acceptance)


@router.post("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/return")
async def portal_return_work(
    project_id: str,
    acceptance_id: str,
    body: PortalAcceptIn,
    db: AsyncSession = Depends(get_db),
):
    """W66 #13: возврат этапа на доработку по magic link (scope accept_stage)."""
    from app.models.entities import AcceptanceStatus, StageStatus, WorkAcceptance
    from app.api.v1.work_acceptances import (
        acceptance_dict,
        require_pending_decision,
        require_stage,
        project_member_ids,
    )
    from app.services import activity_service as act
    from app.services import notification_service as notif

    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims["project_id"] != project_id:
        raise HTTPException(401, "token_mismatch")
    if "accept_stage" not in claims.get("scopes", []):
        raise HTTPException(403, "portal_read_only")

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

    row.status = AcceptanceStatus.returned.value
    row.accepted_by = user.id
    # W139: portal без score → явно без оценки (не оставляем stale)
    row.quality_score = None
    row.comment = body.comment or row.comment
    stage.status = StageStatus.active
    stage.contractor_ready = False
    stage.contractor_ready_at = None
    stage.needs_rework = True
    stage.percent_complete = min(stage.percent_complete or 90, 90)
    await db.commit()
    await db.refresh(row)

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="AcceptanceReturned",
        title=f"Этап возвращён (portal): {stage.name}",
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
            body=body.comment or "Этап возвращён после проверки (портал).",
            link_path=f"/stage/{stage.id}",
            return_to="/(contractor)/(tabs)/home",
        )
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


class PortalScheduleIn(BaseModel):
    token: str
    reason: str | None = None


def _portal_claims(token: str, project_id: str) -> dict:
    """Verify magic-link; 401 on bad/expired token."""
    try:
        claims = portal_tok.verify_portal_token(token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims.get("project_id") != project_id:
        raise HTTPException(403, "token_project_mismatch")
    return claims


def _require_portal_scope(claims: dict, scope: str) -> None:
    if scope not in (claims.get("scopes") or []):
        raise HTTPException(403, f"portal_{scope}_scope_required")


@router.post("/portal/projects/{project_id}/work-schedules/{schedule_id}/confirm")
async def portal_confirm_schedule(
    project_id: str,
    schedule_id: str,
    body: PortalScheduleIn,
    db: AsyncSession = Depends(get_db),
):
    """W57/W60: подтверждение графика по magic link — нужен accept_stage scope."""
    claims = _portal_claims(body.token, project_id)
    # Schedule confirm = согласие заказчика; тот же write-scope, что и приёмка
    _require_portal_scope(claims, "accept_stage")
    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "invalid_token_user")
    project = await require_project(db, project_id, user, write=True)
    from app.services import project_work_schedule_service as wss
    from app.models.entities import ProjectWorkSchedule
    schedule = await db.get(ProjectWorkSchedule, schedule_id)
    if not schedule or schedule.project_id != project_id:
        raise HTTPException(404, "schedule_not_found")
    return await wss.confirm_schedule(db, project=project, schedule=schedule, user=user)


@router.post("/portal/projects/{project_id}/work-schedules/{schedule_id}/reject")
async def portal_reject_schedule(
    project_id: str,
    schedule_id: str,
    body: PortalScheduleIn,
    db: AsyncSession = Depends(get_db),
):
    """W57/W60: отклонение графика — нужен accept_stage scope."""
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "invalid_token_user")
    project = await require_project(db, project_id, user, write=True)
    from app.services import project_work_schedule_service as wss
    from app.models.entities import ProjectWorkSchedule
    schedule = await db.get(ProjectWorkSchedule, schedule_id)
    if not schedule or schedule.project_id != project_id:
        raise HTTPException(404, "schedule_not_found")
    return await wss.reject_schedule(db, project=project, schedule=schedule, user=user, reason=body.reason)



class PortalEstimateIn(BaseModel):
    token: str
    reason: str | None = None


@router.post("/portal/projects/{project_id}/estimate/lock")
async def portal_lock_estimate(
    project_id: str,
    body: PortalEstimateIn,
    db: AsyncSession = Depends(get_db),
):
    """W105: зафиксировать смету по magic link (scope accept_stage, заказчик)."""
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "invalid_token_user")
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.customer_id:
        raise HTTPException(403, "estimate_lock_customer_only")
    from app.services.estimate_service import lock_estimate
    proj, result = await lock_estimate(db, project_id, locked_by=user.id)
    if not proj:
        raise HTTPException(404, detail=result or {"code": "not_found"})
    code = result.get("code") if isinstance(result, dict) else None
    if code in ("already_locked", "empty_estimate", "proposal_required", "proposal_stale"):
        raise HTTPException(409, detail=result)
    if code == "customer_lock_required":
        raise HTTPException(403, detail=result)
    return {
        "ok": True,
        "estimate_locked_at": proj.estimate_locked_at.isoformat() if proj.estimate_locked_at else None,
        "result": result,
    }


@router.post("/portal/projects/{project_id}/estimate/reject")
async def portal_reject_estimate(
    project_id: str,
    body: PortalEstimateIn,
    db: AsyncSession = Depends(get_db),
):
    """W105: отклонить proposal сметы по magic link."""
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "invalid_token_user")
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.customer_id:
        raise HTTPException(403, "estimate_reject_customer_only")
    from app.services.estimate_service import clear_estimate_proposal
    proj, result = await clear_estimate_proposal(
        db,
        project_id,
        cleared_by=user.id,
        reason=body.reason or "Нужна правка сметы",
        mode="reject",
    )
    if not proj:
        raise HTTPException(404, "project_not_found")
    if result.get("code") in ("already_locked", "no_proposal"):
        raise HTTPException(409, detail=result)
    if result.get("code") == "customer_reject_required":
        raise HTTPException(403, detail=result)
    return {"ok": True, "code": "cleared", "reason": body.reason or "Нужна правка сметы"}



class PortalChangeOrderIn(BaseModel):
    token: str


@router.post("/portal/projects/{project_id}/change-orders/{order_id}/approve")
async def portal_approve_change_order(
    project_id: str,
    order_id: str,
    body: PortalChangeOrderIn,
    db: AsyncSession = Depends(get_db),
):
    """Согласование доп. работ из lite-портала (scope accept_stage / customer)."""
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims["project_id"] != project_id:
        raise HTTPException(401, "token_mismatch")
    user = await db.get(User, claims["user_id"])
    project = await db.get(Project, project_id)
    if not user or not project:
        raise HTTPException(404)
    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "change_order_customer_only")
    from app.services import change_order_service as co_svc
    co, _ = await co_svc.approve_with_sign_draft(
        db, project_id=project_id, order_id=order_id, created_by=user.id
    )
    if not co:
        raise HTTPException(404, "change_order_not_found")
    return {"id": co.id, "status": co.status.value}


@router.post("/portal/projects/{project_id}/change-orders/{order_id}/reject")
async def portal_reject_change_order(
    project_id: str,
    order_id: str,
    body: PortalChangeOrderIn,
    db: AsyncSession = Depends(get_db),
):
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")
    if claims["project_id"] != project_id:
        raise HTTPException(401, "token_mismatch")
    user = await db.get(User, claims["user_id"])
    project = await db.get(Project, project_id)
    if not user or not project:
        raise HTTPException(404)
    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "change_order_customer_only")
    from app.services import change_order_service as co_svc
    co = await co_svc.reject(db, order_id)
    if not co or co.project_id != project_id:
        raise HTTPException(404, "change_order_not_found")
    return {"id": co.id, "status": co.status.value}
