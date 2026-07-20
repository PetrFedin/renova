"""Change orders — доп. работы с согласованием заказчиком."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChangeOrder, ChangeOrderStatus
from app.services.budget_service import apply_change_order_to_budget, sync_project_budget_planned


async def create_order(
    db: AsyncSession, project_id: str, user_id: str, title: str, amount: float, description: str | None
) -> ChangeOrder:
    co = ChangeOrder(
        project_id=project_id, title=title, amount=amount, description=description, created_by=user_id
    )
    db.add(co)
    await db.commit()
    await db.refresh(co)
    return co


async def list_orders(db: AsyncSession, project_id: str) -> list[ChangeOrder]:
    r = await db.execute(
        select(ChangeOrder).where(ChangeOrder.project_id == project_id).order_by(ChangeOrder.created_at.desc())
    )
    return list(r.scalars().all())


async def approve(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    """Одобрить CO: статус + BudgetLine + sync budget_planned. Commit внутри."""
    co = await db.get(ChangeOrder, order_id)
    if not co or co.status != ChangeOrderStatus.pending:
        return None
    co.status = ChangeOrderStatus.approved
    await apply_change_order_to_budget(db, co)
    await sync_project_budget_planned(db, co.project_id)
    await db.commit()
    await db.refresh(co)
    return co


async def approve_with_sign_draft(
    db: AsyncSession, *, project_id: str, order_id: str, created_by: str
) -> tuple[ChangeOrder | None, dict | None]:
    """W71: канон approve — бюджет + черновик документа на подпись (единый путь hub/API)."""
    co = await approve(db, order_id)
    if not co or co.project_id != project_id:
        return None, None

    from app.models.project_documents import DocumentStatus, DocumentType
    from app.services import project_document_service as docs_svc

    draft = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=created_by,
        title=f"Доп. работы: {co.title}",
        document_type=DocumentType.contract.value,
        notes=f"CO:{co.id}; сумма {co.amount:.0f} ₽; черновик для подписи",
    )
    draft.status = DocumentStatus.draft.value
    await db.flush()
    # W75: после ДО — синхронизировать активный план-график с этапами/суммами
    schedule_synced = False
    try:
        from sqlalchemy import select
        from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
        from app.services.project_work_schedule_service import sync_items_from_stages

        schedule = (
            await db.execute(
                select(ProjectWorkSchedule)
                .where(ProjectWorkSchedule.project_id == project_id)
                .where(ProjectWorkSchedule.status != WorkScheduleStatus.archived)
                .order_by(ProjectWorkSchedule.created_at.desc())
                .limit(1)
            )
        ).scalars().first()
        if schedule:
            await sync_items_from_stages(db, schedule)
            schedule_synced = True
    except Exception:
        schedule_synced = False
    await db.commit()
    await db.refresh(draft)
    return co, {
        "id": draft.id,
        "title": draft.title,
        "status": draft.status,
        "schedule_synced": schedule_synced,
    }


async def reject(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    co = await db.get(ChangeOrder, order_id)
    if not co or co.status != ChangeOrderStatus.pending:
        return None
    co.status = ChangeOrderStatus.rejected
    await db.commit()
    await db.refresh(co)
    return co
