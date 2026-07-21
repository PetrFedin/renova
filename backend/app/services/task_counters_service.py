"""Единый SoT счётчиков задач / action-required (календарь + inbox + dock).

dueToday / overdue / upcoming — work orders с учётом timezone пользователя.
actionRequired / byType — агрегаты существующих очередей (приёмка, оплаты, …).
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    ChangeOrder,
    ChangeOrderStatus,
    Payment,
    PaymentStatus,
    ProjectIssue,
    WorkOrder,
    WorkOrderStatus,
)
from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
from app.services import acceptance_service as acc_svc

# Статусы WO, которые больше не «задача»
_WO_DONE = {
    WorkOrderStatus.done,
    WorkOrderStatus.paid,
    WorkOrderStatus.cancelled,
}


def local_today(timezone: str) -> date:
    try:
        tz = ZoneInfo(timezone or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


def _open_wo_filter(project_id: str):
    return (
        WorkOrder.project_id == project_id,
        WorkOrder.status.notin_(list(_WO_DONE)),
    )


async def _count_selections_proposed(db: AsyncSession, project_id: str) -> int:
    from app.models.entities import SelectionItem, SelectionStatus

    q = select(func.count()).select_from(SelectionItem).where(
        SelectionItem.project_id == project_id,
        SelectionItem.status == SelectionStatus.proposed,
    )
    return int((await db.execute(q)).scalar_one() or 0)


async def _count_payments_pending(db: AsyncSession, project_id: str, *, role: str) -> int:
    # customer: свои pending; contractor: выставленные pending/paid_unverified
    statuses = [PaymentStatus.pending]
    if hasattr(PaymentStatus, "paid_unverified"):
        statuses.append(PaymentStatus.paid_unverified)
    q = select(func.count()).select_from(Payment).where(
        Payment.project_id == project_id,
        Payment.status.in_(statuses),
    )
    return int((await db.execute(q)).scalar_one() or 0)


async def _count_approvals(db: AsyncSession, project_id: str) -> int:
    # Approvals hub — если сервис есть; иначе 0
    try:
        from app.services import approval_service as appr

        if hasattr(appr, "pending_count"):
            return int(await appr.pending_count(db, project_id))
    except Exception:
        pass
    # Fallback: change orders pending как часть согласований
    return 0


async def _count_change_orders(db: AsyncSession, project_id: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ChangeOrder)
                .where(
                    ChangeOrder.project_id == project_id,
                    ChangeOrder.status == ChangeOrderStatus.pending,
                )
            )
        ).scalar_one()
        or 0
    )


async def _count_warranty(db: AsyncSession, project_id: str) -> int:
    rows = list(
        (
            await db.execute(
                select(ProjectIssue).where(
                    ProjectIssue.project_id == project_id,
                    ProjectIssue.title.startswith("[Гарантия]"),
                    ProjectIssue.status != "closed",
                )
            )
        ).scalars().all()
    )
    return len(rows)


async def _count_quality_fixed(db: AsyncSession, project_id: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ProjectIssue)
                .where(
                    ProjectIssue.project_id == project_id,
                    ProjectIssue.status == "fixed",
                )
            )
        ).scalar_one()
        or 0
    )


async def _count_schedule_submitted(db: AsyncSession, project_id: str) -> int:
    row = (
        await db.execute(
            select(ProjectWorkSchedule)
            .where(
                ProjectWorkSchedule.project_id == project_id,
                ProjectWorkSchedule.status == WorkScheduleStatus.submitted,
            )
            .order_by(ProjectWorkSchedule.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    return 1 if row else 0


async def _count_documents_draft(db: AsyncSession, project_id: str) -> int:
    try:
        from app.models.project_documents import DocumentStatus, ProjectDocument

        return int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(ProjectDocument)
                    .where(
                        ProjectDocument.project_id == project_id,
                        ProjectDocument.status == DocumentStatus.draft.value,
                    )
                )
            ).scalar_one()
            or 0
        )
    except Exception:
        return 0


async def _wo_date_counts(
    db: AsyncSession,
    project_id: str,
    today: date,
) -> tuple[int, int, int]:
    """dueToday, overdue, upcoming (7 дней)."""
    rows = list(
        (
            await db.execute(
                select(WorkOrder).where(*_open_wo_filter(project_id))
            )
        ).scalars().all()
    )
    due_today = 0
    overdue = 0
    upcoming = 0
    horizon = today + timedelta(days=7)
    for wo in rows:
        start = wo.planned_start
        end = wo.planned_end
        if end and end < today:
            overdue += 1
            continue
        # пересечение с сегодня
        if start and end:
            if start <= today <= end:
                due_today += 1
                continue
        elif end == today or start == today:
            due_today += 1
            continue
        # upcoming: старт в ближайшие 7 дней
        if start and today < start <= horizon:
            upcoming += 1
    return due_today, overdue, upcoming


async def build_task_counters(
    db: AsyncSession,
    *,
    project_id: str,
    role: str,
    timezone: str = "Europe/Moscow",
) -> dict[str, Any]:
    """Атомарный snapshot счётчиков для project + role + timezone."""
    today = local_today(timezone)
    due_today, overdue, upcoming = await _wo_date_counts(db, project_id, today)

    role_l = (role or "customer").lower()
    acceptance = await acc_svc.pending_count(db, project_id)
    selection = await _count_selections_proposed(db, project_id)
    payment = await _count_payments_pending(db, project_id, role=role_l)
    change_order = await _count_change_orders(db, project_id)
    warranty = await _count_warranty(db, project_id)
    quality = await _count_quality_fixed(db, project_id)
    schedule = await _count_schedule_submitted(db, project_id)
    document = await _count_documents_draft(db, project_id)
    approval = change_order  # согласования ДО входят в approvals UX

    # Ролевая видимость: contractor не считает customer-only QC fixed как свою «задачу» иначе
    by_type: dict[str, int] = {
        "calendar": due_today,
        "acceptance": acceptance,
        "selection": selection,
        "payment": payment,
        "change_order": change_order,
        "approval": approval,
        "warranty": warranty,
        "quality": quality if role_l in ("customer", "owner") else 0,
        "schedule": schedule,
        "document": document if role_l in ("customer", "owner") else 0,
        "overdue": overdue,
    }

    # actionRequired = число категорий с >0 (как inboxTaskBadge: 1 row per kind)
    # плюс overdue как отдельная категория если >0
    action_kinds = (
        "acceptance",
        "selection",
        "payment",
        "change_order",
        "warranty",
        "quality",
        "schedule",
        "document",
    )
    action_required = sum(1 for k in action_kinds if by_type.get(k, 0) > 0)
    if overdue > 0:
        action_required += 1

    return {
        "dueToday": due_today,
        "overdue": overdue,
        "upcoming": upcoming,
        "actionRequired": action_required,
        "byType": by_type,
        "revision": int(time.time() * 1000),
        "asOfDate": today.isoformat(),
        "timezone": timezone,
        "projectId": project_id,
        "role": role_l,
        "definitions": {
            "dueToday": "Open work orders whose planned range overlaps local today (exclude done/paid/cancelled)",
            "overdue": "Open work orders with planned_end < local today",
            "upcoming": "Open work orders starting within next 7 local days",
            "actionRequired": "Count of non-zero action categories (inbox-row semantics) + overdue flag",
            "calendarBadge": "dueToday",
            "inboxTaskBadge": "actionRequired",
        },
    }


async def publish_task_updated(
    *,
    user_ids: list[str],
    project_id: str,
    task_id: str | None = None,
    revision: int | None = None,
    counter_delta: dict | None = None,
) -> None:
    """Нормализованное событие → inbox WS (тот же канал, type=task.updated)."""
    from app.api.v1.ws import broadcast_inbox

    rev = revision if revision is not None else int(time.time() * 1000)
    payload = {
        "type": "task.updated",
        "event": "task.updated",
        "task_id": task_id,
        "project_id": project_id,
        "revision": rev,
        "counter_delta": counter_delta or {},
    }
    for uid in user_ids:
        if uid:
            await broadcast_inbox(uid, payload)
