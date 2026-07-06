"""Renova OS API — риски, workflow, замечания."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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

router = APIRouter(tags=["renova-os"])


class IssueIn(BaseModel):
    title: str
    description: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    severity: str = "medium"


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
    await require_project(db, project_id, user, write=True)
    issue = await iss.create_issue(
        db, project_id, body.title,
        description=body.description, room_id=body.room_id, stage_id=body.stage_id, severity=body.severity,
    )
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="IssueCreated", title=issue.title, body=issue.severity, link_path="/(customer)/(tabs)/control")
    return iss.issue_dict(issue)


@router.post("/projects/{project_id}/issues/{issue_id}/close")
async def close_issue(project_id: str, issue_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    issue = await iss.update_issue_status(db, issue_id, "closed")
    if not issue or issue.project_id != project_id:
        raise HTTPException(404)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="IssueClosed", title=issue.title, link_path="/(customer)/(tabs)/control")
    return iss.issue_dict(issue)

@router.post("/projects/{project_id}/rooms/{room_id}/calc-materials")
async def calc_room_materials(
    project_id: str,
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.entities import Room
    from app.services.material_calculator import calc_room_materials as calc_fn
    await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    items = calc_fn(room.floor_sq_m, room.wall_sq_m, room.perimeter_m)
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
    from app.services import acceptance_service as acc_svc
    from app.models.entities import UserRole
    await require_project(db, project_id, user, write=True)
    if user.role not in (UserRole.customer,):
        raise HTTPException(403, "Только заказчик может принять этап")
    from app.models.entities import WorkAcceptance
    acc = await db.get(__import__("app.models.entities", fromlist=["WorkAcceptance"]).WorkAcceptance, acceptance_id)
    if not acc or acc.project_id != project_id:
        raise HTTPException(404)
    from app.services import issue_service as iss
    issues = await iss.list_issues(db, project_id, status=None)
    open_n = len([i for i in issues if i.stage_id == acc.stage_id and i.status != "closed"])
    updated = await acc_svc.accept(db, acceptance_id, accepted_by=user.id, with_remarks=body.with_remarks, comment=body.comment, open_issues=open_n)
    if not updated:
        raise HTTPException(400)
    stage = await proj_svc.accept_stage(db, acc.stage_id)
    if not stage:
        raise HTTPException(409, "Этап не в статусе приёмки")
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="AcceptancePassed", title=f"Принято: {stage.name}", body=str(updated.quality_score), link_path=f"/stage/{stage.id}", stage_id=stage.id)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="InspectionRequested", title=f"Приёмка завершена: {stage.name}", stage_id=stage.id)
    return acc_svc.acceptance_dict(updated, stage)


@router.post("/projects/{project_id}/acceptances/{acceptance_id}/return")
async def return_work(project_id: str, acceptance_id: str, body: ReturnIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import acceptance_service as acc_svc
    from app.models.entities import UserRole, WorkAcceptance
    await require_project(db, project_id, user, write=True)
    if user.role not in (UserRole.customer,):
        raise HTTPException(403)
    acc = await db.get(WorkAcceptance, acceptance_id)
    if not acc or acc.project_id != project_id:
        raise HTTPException(404)
    updated = await acc_svc.return_for_rework(db, acceptance_id, comment=body.comment)
    stage = await proj_svc.reject_stage(db, acc.stage_id, user.id, body.comment)
    if not stage:
        raise HTTPException(409)
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="AcceptanceReturned", title=f"Возврат: {stage.name}", body=body.comment, stage_id=stage.id)
    return acc_svc.acceptance_dict(updated, stage) if updated else {}


@router.get("/projects/{project_id}/os/budget")
async def os_budget(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=False)
    return await bud.budget_summary(db, project_id)


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
