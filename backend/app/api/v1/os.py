"""Renova OS API — риски, workflow, замечания."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.data.workflow_templates import WORKFLOW_TEMPLATES, get_template
from app.db.session import get_db
from app.models.entities import User
from app.services import activity_service as act
from app.services import issue_service as iss
from app.services import project_service as proj_svc
from app.services import risk_engine as risk
from app.services import stage_service as stage_svc
from app.services import workflow_service as wf
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(tags=["renova-os"])


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


class IssueIn(BaseModel):
    title: str
    description: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    floor_plan_id: str | None = None
    x_pct: float | None = Field(default=None, ge=0, le=100)
    y_pct: float | None = Field(default=None, ge=0, le=100)
    photo_key: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class CheckIn(BaseModel):
    item_id: str
    done: bool


@router.get("/projects/{project_id}/os/risks")
async def project_risks(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    p = await risk.load_project_for_risks(db, project_id)
    if not p:
        raise HTTPException(404)
    items = await risk.compute_project_risks(db, p)
    return {"count": len(items), "items": items}


@router.get("/workflow-templates")
async def list_workflow_templates():
    return [{"work_type": k, "name": v["name"], "steps_count": len(v.get("steps", [])), "checklist_count": len(v.get("checklist", []))} for k, v in WORKFLOW_TEMPLATES.items()]


@router.get("/workflow-templates/{work_type}")
async def workflow_template(work_type: str):
    return get_template(work_type)


@router.get("/projects/{project_id}/stages/{stage_id}/workflow")
async def stage_workflow(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    await wf.ensure_stage_checklist(db, stage)
    return wf.workflow_dict(stage)


@router.post("/projects/{project_id}/stages/{stage_id}/checklist/toggle")
async def toggle_checklist(
    project_id: str,
    stage_id: str,
    body: CheckIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    items = await wf.toggle_checklist_item(db, stage, body.item_id, body.done)
    return {"checklist": items, "progress": wf.checklist_progress(items)}


@router.get("/projects/{project_id}/issues")
async def list_issues(project_id: str, status: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items = await iss.list_issues(db, project_id, status)
    return [iss.issue_dict(i) for i in items]


@router.post("/projects/{project_id}/issues")
async def create_issue(
    project_id: str,
    body: IssueIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import team_service as team_svc
    project = await require_project(db, project_id, user, write=True)
    await team_svc.require_capability(db, user, project, "field_write")
    try:
        issue, _created = await iss.create_or_replay_issue(
            db, project_id, body.title,
            user_id=user.id,
            description=body.description, room_id=body.room_id, stage_id=body.stage_id, severity=body.severity,
            floor_plan_id=body.floor_plan_id, x_pct=body.x_pct, y_pct=body.y_pct, photo_key=body.photo_key,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    except ValueError as exc:
        code = str(exc)
        if code in ("issue_room_not_found", "issue_stage_not_found", "issue_floor_plan_not_found"):
            raise HTTPException(404, detail=code) from exc
        if code == "issue_idempotency_target_missing":
            raise HTTPException(409, detail={"code": code}) from exc
        raise
    # The IssueCreated activity event and recipient notification(s) were
    # already enqueued atomically with the ProjectIssue + ClientWriteRequest
    # commit above (see client_write_side_effects.prepare_client_write_side_effects,
    # scope "issue.create") — no separate post-create commit boundary here.
    return iss.issue_dict(issue)


@router.post("/projects/{project_id}/issues/{issue_id}/close")
async def close_issue(project_id: str, issue_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Legacy: contractor → fixed (+notify customer); customer → closed (+notify contractor).

    Тот же граф и те же права, что у /transition; недоступный переход — 409/403 с кодом
    (раньше «плоский» 404, хотя замечание существует — QLT-005).
    """
    from app.models.entities import ProjectIssue, UserRole
    from app.services import notification_service as notif_svc

    project = await require_project(db, project_id, user, write=True)
    existing = await db.get(ProjectIssue, issue_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404)
    if (existing.title or "").startswith("[Гарантия]"):
        if user.role != UserRole.customer or user.id != project.customer_id:
            raise HTTPException(403, "warranty_close_customer_only")
        # Гарантия закрывается своим контуром (идемпотентно, с уведомлением исполнителю).
        from app.services import warranty_claim_service as warranty_svc

        closed, _changed = await warranty_svc.close_claim(db, project=project, actor=user, issue_id=issue_id)
        return iss.issue_dict(closed)
    self_managed = project.contractor_id is None
    # W64: исполнитель отмечает исправление; финал closed — у заказчика
    next_status = "fixed" if user.role == UserRole.contractor else "closed"
    previous = existing.status
    try:
        issue = await iss.transition_issue(db, existing, next_status, user.role, self_managed=self_managed)
    except ValueError as exc:
        code = str(exc)
        if code == "issue_transition_role_forbidden":
            raise HTTPException(403, detail={"code": code, "message": "Этот переход недоступен для вашей роли."}) from exc
        raise HTTPException(
            409,
            detail={
                "code": code.split(":")[0],
                "message": f"Замечание в статусе «{previous}» нельзя перевести в «{next_status}».",
                "from": previous,
                "to": next_status,
            },
        ) from exc

    event_kind = "IssueFixed" if next_status == "fixed" else "IssueClosed"
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind=event_kind,
        title=issue.title,
        body="Исправление отмечено — подтвердите в Контроле" if next_status == "fixed" else "Замечание закрыто",
        link_path="/control",
    )

    # Честный контур: заказчик узнаёт про fixed; исполнитель — про финальное closed
    if next_status == "fixed" and project.customer_id and project.customer_id != user.id:
        await notif_svc.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="issue",
            title=f"Исправлено: {issue.title}",
            body="Подтвердите устранение в Контроле качества",
            link_path="/control",
        )
    elif next_status == "closed" and project.contractor_id and project.contractor_id != user.id:
        await notif_svc.notify(
            db,
            user_id=project.contractor_id,
            project_id=project_id,
            notification_type="issue",
            title=f"Закрыто: {issue.title}",
            body="Заказчик подтвердил устранение замечания",
            link_path="/control",
        )

    return iss.issue_dict(issue)



@router.post("/projects/{project_id}/issues/{issue_id}/escalate")
async def escalate_issue(
    project_id: str,
    issue_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W69 #50 / W73: эскалация — customer или owner/foreman бригады."""
    from app.models.entities import ProjectIssue, UserRole
    from app.services import team_service as team_svc
    project = await require_project(db, project_id, user, write=True)
    await team_svc.require_capability(db, user, project, "escalate")
    existing = await db.get(ProjectIssue, issue_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404)
    if existing.status == "closed":
        raise HTTPException(409, detail={"code": "issue_closed", "message": "Закрытое замечание нельзя эскалировать"})
    title = existing.title or "Замечание"
    if not title.startswith("[Спор]"):
        existing.title = f"[Спор] {title}"
    existing.severity = "critical"
    if existing.status in ("fixed", "review"):
        existing.status = "open"
    await db.commit()
    await db.refresh(existing)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="IssueEscalated",
        title=existing.title,
        body="Эскалация спора",
        link_path="/control",
    )
    from app.services import notification_service as notif_svc
    for uid in {project.customer_id, project.contractor_id}:
        if not uid or uid == user.id:
            continue
        await notif_svc.notify(
            db,
            user_id=uid,
            project_id=project_id,
            notification_type="issue",
            title=f"Спор эскалирован: {existing.title}",
            body="Требуется совместное решение — откройте Контроль качества",
            link_path="/control",
        )
    return iss.issue_dict(existing)


@router.post("/projects/{project_id}/rooms/{room_id}/calc-materials")
async def calc_room_materials(
    project_id: str,
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.entities import Room
    from app.services.material_calculator import calc_room_materials as calc_fn
    from sqlalchemy import select
    from app.services.room_service import room_detail
    # Роут пишет activity — значит нужен write-доступ (гость/технадзор не пишут).
    await require_project(db, project_id, user, write=True)
    room = (await db.execute(select(Room).where(Room.id == room_id, Room.project_id == project_id))).scalar_one_or_none()
    if not room:
        raise HTTPException(404)
    # EST-009: у ORM Room нет floor_sq_m/wall_sq_m/perimeter_m — считаем из размеров.
    metrics = room_detail(room)
    if not (metrics["floor_sq_m"] > 0 and metrics["wall_sq_m"] > 0 and metrics["perimeter_m"] > 0):
        raise HTTPException(
            422,
            detail={
                "code": "room_dimensions_incomplete",
                "message": "Укажите длину, ширину и высоту комнаты — без размеров материалы не рассчитать",
            },
        )
    items = calc_fn(metrics["floor_sq_m"], metrics["wall_sq_m"], metrics["perimeter_m"])
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="MaterialCalculated", title=f"Расчёт: {room.name}", body=str(len(items)), room_id=room_id, link_path=f"/room/{room_id}")
    return {"room_id": room_id, "items": items}

class AcceptIn(BaseModel):
    with_remarks: bool = False
    comment: str | None = None


class ReturnIn(BaseModel):
    comment: str | None = None


@router.get("/projects/{project_id}/acceptances")
async def list_acceptances(project_id: str, status: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import acceptance_service as acc_svc
    await require_project(db, project_id, user, write=False)
    rows = await acc_svc.list_acceptances(db, project_id, status=status)
    return [acc_svc.acceptance_dict(a, s) for a, s in rows]


@router.get("/projects/{project_id}/acceptances/pending-count")
async def acceptances_pending(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import acceptance_service as acc_svc
    await require_project(db, project_id, user, write=False)
    return {"count": await acc_svc.pending_count(db, project_id)}


@router.post("/projects/{project_id}/acceptances/{acceptance_id}/accept")
async def accept_work(project_id: str, acceptance_id: str, body: AcceptIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.api.v1.work_acceptances import AcceptanceDecisionIn, accept_work as canon_accept_work

    # W139: без fake 8/10 — оценка только если клиент передал явно (legacy AcceptIn не имеет score)
    decision = AcceptanceDecisionIn(
        comment=body.comment,
        create_issue=body.with_remarks,
        quality_score=None,
    )
    return await canon_accept_work(project_id, acceptance_id, decision, user, db)


@router.post("/projects/{project_id}/acceptances/{acceptance_id}/return")
async def return_work(project_id: str, acceptance_id: str, body: ReturnIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.api.v1.work_acceptances import AcceptanceDecisionIn, return_work as canon_return_work

    decision = AcceptanceDecisionIn(
        comment=body.comment,
        create_issue=True,
        quality_score=None,
    )
    return await canon_return_work(project_id, acceptance_id, decision, user, db)


@router.get("/projects/{project_id}/os/budget")
async def os_budget(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=False)
    return await bud.budget_summary(db, project_id)




@router.get("/projects/{project_id}/budget-summary")
async def budget_summary_hub(
    project_id: str,
    threshold_pct: float = 5,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """P2.5: единый JSON для mobile «Бюджет» hub."""
    from app.services import budget_service as bud

    await require_project(db, project_id, user, write=False)
    return await bud.budget_hub(db, project_id, threshold_pct=threshold_pct)

@router.get("/projects/{project_id}/os/budget/lines")
async def os_budget_lines(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=False)
    lines = await bud.sync_budget_lines_from_estimate(db, project_id)
    await bud.refresh_budget_facts(db, project_id)
    await db.commit()
    refreshed = await bud.sync_budget_lines_from_estimate(db, project_id)
    from sqlalchemy import select
    from app.models.entities import BudgetLine
    all_lines = (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    return [bud.budget_line_dict(bl) for bl in all_lines]


@router.get("/projects/{project_id}/os/expenses")
async def os_expenses(project_id: str, status: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=False)
    await bud.refresh_budget_facts(db, project_id)
    await db.commit()
    items = await bud.list_expenses(db, project_id, status=status)
    return [bud.expense_dict(e) for e in items]

class ExpensePatch(BaseModel):
    amount: float | None = None
    title: str | None = None
    category: str | None = None
    room_id: str | None = None
    stage_id: str | None = None


@router.patch("/projects/{project_id}/os/expenses/{expense_id}")
async def patch_os_expense(
    project_id: str,
    expense_id: str,
    body: ExpensePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=True)
    exp = await bud.get_expense(db, expense_id)
    if not exp or exp.project_id != project_id or exp.status == "deleted":
        raise HTTPException(404)
    try:
        updated = await bud.update_expense(
            db,
            exp,
            amount=body.amount,
            title=body.title,
            category=body.category,
            room_id=body.room_id,
            stage_id=body.stage_id,
        )
    except ValueError as e:
        code = str(e)
        if code == "linked_expense":
            raise HTTPException(400, detail="Расход связан с чеком или оплатой — редактируйте источник")
        if code == "invalid_amount":
            raise HTTPException(400, detail="Сумма должна быть больше 0")
        raise HTTPException(400, detail=code)
    await db.commit()
    return bud.expense_dict(updated)


@router.delete("/projects/{project_id}/os/expenses/{expense_id}")
async def delete_os_expense(
    project_id: str,
    expense_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=True)
    exp = await bud.get_expense(db, expense_id)
    if not exp or exp.project_id != project_id or exp.status == "deleted":
        raise HTTPException(404)
    try:
        await bud.delete_expense(db, exp)
    except ValueError as e:
        code = str(e)
        if code == "linked_payment":
            raise HTTPException(400, detail="Нельзя удалить расход из подтверждённой оплаты")
        if code == "linked_receipt":
            raise HTTPException(400, detail="Удалите чек — расход обновится автоматически")
        raise HTTPException(400, detail=code)
    await db.commit()
    return {"ok": True}




@router.get("/projects/{project_id}/os/schedule")
async def os_schedule(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import schedule_service as sched
    p = await require_project(db, project_id, user, write=False)
    return await sched.build_schedule_summary(db, p)


@router.get("/projects/{project_id}/stages/{stage_id}/snapshot")
async def work_snapshot(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import work_snapshot_service as ws
    p = await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return await ws.build_work_snapshot(db, stage, p, role=role)


@router.get("/projects/{project_id}/stages/{stage_id}/completion-check")
async def completion_check(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import work_snapshot_service as ws
    p = await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    return await ws.completion_check(db, stage, p)


@router.get("/projects/{project_id}/os/insights")
async def os_insights(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import ai_insights_service as ai
    p = await require_project(db, project_id, user, write=False)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    items = await ai.compute_project_insights(db, p, role=role)
    return {"count": len(items), "items": items}


@router.get("/projects/{project_id}/rooms/{room_id}/snapshot")
async def room_snapshot(project_id: str, room_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Room
    from app.services import room_snapshot_service as rs
    p = await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    return await rs.build_room_snapshot(db, p, room)
