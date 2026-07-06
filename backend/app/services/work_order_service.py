"""Заказы работ — детальные задачи по комнатам, датам, статусам."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import WorkOrder, WorkOrderStatus
from app.services import activity_service as act
from app.services import chat_service as chat_svc

ALLOWED: dict[str, set[str]] = {
    WorkOrderStatus.draft.value: {WorkOrderStatus.published.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.published.value: {WorkOrderStatus.negotiating.value, WorkOrderStatus.approved.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.negotiating.value: {WorkOrderStatus.approved.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.approved.value: {WorkOrderStatus.in_progress.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.in_progress.value: {WorkOrderStatus.review.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.review.value: {WorkOrderStatus.done.value, WorkOrderStatus.in_progress.value},
    WorkOrderStatus.done.value: {WorkOrderStatus.paid.value},
    WorkOrderStatus.paid.value: set(),
    WorkOrderStatus.cancelled.value: set(),
}


def wo_dict(w: WorkOrder) -> dict:
    return {
        "id": w.id,
        "project_id": w.project_id,
        "room_id": w.room_id,
        "stage_id": w.stage_id,
        "work_type": w.work_type,
        "title": w.title,
        "status": w.status.value if hasattr(w.status, "value") else w.status,
        "planned_start": w.planned_start.isoformat() if w.planned_start else None,
        "planned_end": w.planned_end.isoformat() if w.planned_end else None,
        "actual_start": w.actual_start.isoformat() if w.actual_start else None,
        "actual_end": w.actual_end.isoformat() if w.actual_end else None,
        "assignee_id": w.assignee_id,
        "chat_thread_id": w.chat_thread_id,
        "budget_planned": w.budget_planned,
        "budget_spent": w.budget_spent,
        "notes": w.notes,
        "created_by": w.created_by,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


async def list_work_orders(db: AsyncSession, project_id: str) -> list[dict]:
    rows = (await db.execute(select(WorkOrder).where(WorkOrder.project_id == project_id).order_by(WorkOrder.planned_start.nullslast()))).scalars().all()
    return [wo_dict(w) for w in rows]


async def create_work_order(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    work_type: str,
    room_id: str | None = None,
    stage_id: str | None = None,
    planned_start: date | None = None,
    planned_end: date | None = None,
    budget_planned: float = 0,
    notes: str | None = None,
    publish: bool = False,
) -> WorkOrder:
    w = WorkOrder(
        project_id=project_id,
        room_id=room_id,
        stage_id=stage_id,
        work_type=work_type,
        title=title,
        status=WorkOrderStatus.published if publish else WorkOrderStatus.draft,
        planned_start=planned_start,
        planned_end=planned_end or planned_start,
        budget_planned=budget_planned,
        notes=notes,
        created_by=user_id,
    )
    db.add(w)
    await db.flush()
    thread = await chat_svc.create_thread(db, project_id, user_id, f"Работа: {title}", topic=f"work:{w.id}")
    w.chat_thread_id = thread.id
    await act.log_event(
        db, project_id=project_id, user_id=user_id, kind="work",
        title=f"Задача: {title}", body=notes, room_id=room_id, work_type=work_type,
        link_path=f"/work-order/{w.id}", stage_id=stage_id,
    )
    await db.commit()
    await db.refresh(w)
    return w


async def update_work_order(db: AsyncSession, w: WorkOrder, patch: dict) -> WorkOrder:
    for k in ("title", "work_type", "room_id", "stage_id", "notes", "assignee_id", "budget_planned"):
        if k in patch:
            setattr(w, k, patch[k])
    for k in ("planned_start", "planned_end", "actual_start", "actual_end"):
        if k in patch:
            v = patch[k]
            setattr(w, k, date.fromisoformat(v) if isinstance(v, str) and v else v)
    w.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(w)
    return w


async def transition(db: AsyncSession, w: WorkOrder, new_status: str, user_id: str) -> WorkOrder:
    cur = w.status.value if hasattr(w.status, "value") else w.status
    if new_status not in ALLOWED.get(cur, set()):
        raise ValueError(f"Нельзя перейти из {cur} в {new_status}")
    w.status = WorkOrderStatus(new_status)
    today = date.today()
    if new_status == WorkOrderStatus.in_progress.value and not w.actual_start:
        w.actual_start = today
    if new_status == WorkOrderStatus.done.value and not w.actual_end:
        w.actual_end = today
    w.updated_at = datetime.utcnow()
    await act.log_event(
        db, project_id=w.project_id, user_id=user_id, kind="work_status",
        title=f"{w.title}: {new_status}", room_id=w.room_id, work_type=w.work_type,
        link_path=f"/work-order/{w.id}", stage_id=w.stage_id,
    )
    await db.commit()
    await db.refresh(w)
    return w


async def get_work_order(db: AsyncSession, work_order_id: str) -> WorkOrder | None:
    return (await db.execute(select(WorkOrder).where(WorkOrder.id == work_order_id))).scalar_one_or_none()
