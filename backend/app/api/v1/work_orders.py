"""API заказов работ — детальное планирование по комнатам."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import work_order_service as wo_svc

router = APIRouter(prefix="/projects", tags=["work-orders"])


class WorkOrderCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    work_type: str = Field(min_length=1, max_length=64)
    room_id: str | None = None
    stage_id: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    budget_planned: float = 0
    notes: str | None = None
    publish: bool = False


class WorkOrderPatch(BaseModel):
    title: str | None = None
    work_type: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    notes: str | None = None
    assignee_id: str | None = None
    budget_planned: float | None = None


class WorkOrderTransition(BaseModel):
    status: str


@router.get("/{project_id}/work-orders")
async def list_work_orders(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    return await wo_svc.list_work_orders(db, project_id)


@router.post("/{project_id}/work-orders")
async def create_work_order(project_id: str, body: WorkOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    work_order = await wo_svc.create_work_order(
        db,
        project_id=project_id,
        user_id=user.id,
        title=body.title,
        work_type=body.work_type,
        room_id=body.room_id,
        stage_id=body.stage_id,
        planned_start=body.planned_start,
        planned_end=body.planned_end,
        budget_planned=body.budget_planned,
        notes=body.notes,
        publish=body.publish,
    )
    return wo_svc.wo_dict(work_order)


@router.get("/{project_id}/work-orders/{work_order_id}")
async def get_work_order(project_id: str, work_order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    work_order = await wo_svc.get_work_order(db, work_order_id)
    if not work_order or work_order.project_id != project_id:
        raise HTTPException(404)
    return wo_svc.wo_dict(work_order)


@router.patch("/{project_id}/work-orders/{work_order_id}")
async def patch_work_order(project_id: str, work_order_id: str, body: WorkOrderPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    work_order = await wo_svc.get_work_order(db, work_order_id)
    if not work_order or work_order.project_id != project_id:
        raise HTTPException(404)
    work_order = await wo_svc.update_work_order(db, work_order, body.model_dump(exclude_unset=True))
    return wo_svc.wo_dict(work_order)


@router.post("/{project_id}/work-orders/{work_order_id}/transition")
async def transition_work_order(project_id: str, work_order_id: str, body: WorkOrderTransition, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    work_order = await wo_svc.get_work_order(db, work_order_id)
    if not work_order or work_order.project_id != project_id:
        raise HTTPException(404)
    try:
        work_order = await wo_svc.transition(
            db,
            work_order,
            body.status,
            user.id,
            user.role,
            project=project,
        )
    except ValueError as error:
        code = str(error)
        if code in ("only_customer_can_accept_work_order", "work_order_role_forbidden"):
            raise HTTPException(403, code) from error
        if code in (
            "payment_transition_required",
            "work_order_project_missing",
            "work_order_stale",
            "work_order_missing",
        ):
            raise HTTPException(409, code) from error
        raise HTTPException(400, code) from error
    return wo_svc.wo_dict(work_order)
