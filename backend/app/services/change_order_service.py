"""Change orders — доп. работы с согласованием заказчиком."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChangeOrder, ChangeOrderStatus, Project
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.services.budget_service import apply_change_order_to_budget, sync_project_budget_planned
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects


def _member_ids(project: Project) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for user_id in [project.customer_id, project.contractor_id]:
        if user_id and user_id not in seen:
            seen.add(user_id)
            result.append(user_id)
    return result


async def create_order(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str,
    amount: float,
    description: str | None,
) -> ChangeOrder:
    order = ChangeOrder(
        project_id=project_id,
        title=title,
        amount=amount,
        description=description,
        created_by=user_id,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return order


async def list_orders(db: AsyncSession, project_id: str) -> list[ChangeOrder]:
    result = await db.execute(
        select(ChangeOrder)
        .where(ChangeOrder.project_id == project_id)
        .order_by(ChangeOrder.created_at.desc())
    )
    return list(result.scalars().all())


async def approve(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    """Legacy budget-only path, now row-locked and replay-safe."""
    query = select(ChangeOrder).where(ChangeOrder.id == order_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    order = (await db.execute(query)).scalar_one_or_none()
    if not order or order.status == ChangeOrderStatus.rejected:
        return None
    if order.status == ChangeOrderStatus.approved:
        await db.commit()
        return order
    order.status = ChangeOrderStatus.approved
    await apply_change_order_to_budget(db, order)
    await sync_project_budget_planned(db, order.project_id)
    await db.commit()
    await db.refresh(order)
    return order


async def _linked_document(db: AsyncSession, order_id: str) -> ProjectDocument | None:
    return (
        await db.execute(
            select(ProjectDocument)
            .where(ProjectDocument.change_order_id == order_id)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _prepare_approval_side_effects(
    db: AsyncSession,
    *,
    project: Project,
    order: ChangeOrder,
    approved_by: str,
    document_id: str,
) -> list[PreparedSideEffect]:
    from app.services import outbox_service as outbox

    effects: list[PreparedSideEffect] = []
    for payload in [
        {
            "kind": "DocumentDraftForSign",
            "title": f"Подпишите доп. работы: {order.title}",
            "body": f"Документ {document_id} · {order.amount:.0f} ₽",
            "link_path": "/documents",
        },
        {
            "kind": "ChangeOrderApproved",
            "title": f"Доп. работы согласованы: {order.title}",
            "body": str(order.amount),
            "link_path": "/(customer)/(tabs)/budget",
        },
    ]:
        row = await outbox.enqueue(
            db,
            aggregate_type="change_order",
            aggregate_id=order.id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project.id,
                "user_id": approved_by,
                **payload,
            },
        )
        effects.append(PreparedSideEffect(effect_type="activity", outbox_id=row.id))

    for member_id in _member_ids(project):
        if member_id == approved_by:
            continue
        row = await outbox.enqueue(
            db,
            aggregate_type="change_order",
            aggregate_id=order.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "change_order",
                "title": f"Доп. работы согласованы: {order.title}",
                "body": str(order.amount),
                "link_path": "/(contractor)/(tabs)/budget",
                "return_to": "/(contractor)/(tabs)/home",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=row.id,
                match_key=member_id,
            )
        )

    if project.customer_id:
        row = await outbox.enqueue(
            db,
            aggregate_type="change_order",
            aggregate_id=order.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project.id,
                "notification_type": "document",
                "title": f"Подпишите доп. работы: {order.title}",
                "body": f"Черновик в Документах · {order.amount:.0f} ₽",
                "link_path": "/documents",
                "return_to": "/(customer)/(tabs)/",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=row.id,
                match_key=project.customer_id,
            )
        )
    return effects


async def _prepare_rejection_side_effects(
    db: AsyncSession,
    *,
    project: Project,
    order: ChangeOrder,
    rejected_by: str,
) -> list[PreparedSideEffect]:
    from app.services import outbox_service as outbox

    activity_row = await outbox.enqueue(
        db,
        aggregate_type="change_order",
        aggregate_id=order.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project.id,
            "user_id": rejected_by,
            "kind": "ChangeOrderRejected",
            "title": f"Доп. работы отклонены: {order.title}",
            "body": order.description,
            "link_path": "/(customer)/(tabs)/budget",
        },
    )
    effects = [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]
    for member_id in _member_ids(project):
        if member_id == rejected_by:
            continue
        row = await outbox.enqueue(
            db,
            aggregate_type="change_order",
            aggregate_id=order.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": member_id,
                "project_id": project.id,
                "notification_type": "change_order",
                "title": f"Доп. работы отклонены: {order.title}",
                "body": order.description or "",
                "link_path": "/(contractor)/(tabs)/budget",
                "return_to": "/(contractor)/(tabs)/home",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=row.id,
                match_key=member_id,
            )
        )
    return effects


async def approve_with_sign_draft(
    db: AsyncSession,
    *,
    project_id: str,
    order_id: str,
    created_by: str,
) -> tuple[ChangeOrder | None, dict | None]:
    """Atomically approve CO, update budget, create one draft and queue effects."""
    query = select(ChangeOrder).where(
        ChangeOrder.id == order_id,
        ChangeOrder.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    order = (await db.execute(query)).scalar_one_or_none()
    if not order or order.status == ChangeOrderStatus.rejected:
        return None, None

    existing_document = await _linked_document(db, order.id)
    if order.status == ChangeOrderStatus.approved and existing_document:
        await db.commit()
        return order, {
            "id": existing_document.id,
            "title": existing_document.title,
            "status": existing_document.status,
            "schedule_synced": False,
            "replayed": True,
        }

    newly_approved = order.status == ChangeOrderStatus.pending
    if newly_approved:
        order.status = ChangeOrderStatus.approved

    await apply_change_order_to_budget(db, order)
    await sync_project_budget_planned(db, order.project_id)

    from app.services import project_document_service as documents

    draft = existing_document
    if not draft:
        draft = await documents.create_document(
            db,
            project_id=project_id,
            created_by=created_by,
            title=f"Доп. работы: {order.title}",
            document_type=DocumentType.contract.value,
            change_order_id=order.id,
            notes=f"CO:{order.id}; сумма {order.amount:.0f} ₽; черновик для подписи",
        )
    draft.status = DocumentStatus.draft.value
    await db.flush()

    schedule_synced = False
    try:
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

    project = await db.get(Project, project_id)
    effects = (
        await _prepare_approval_side_effects(
            db,
            project=project,
            order=order,
            approved_by=created_by,
            document_id=draft.id,
        )
        if project
        else []
    )

    await db.commit()
    await db.refresh(order)
    await db.refresh(draft)
    activate_client_write_side_effects(effects)
    return order, {
        "id": draft.id,
        "title": draft.title,
        "status": draft.status,
        "schedule_synced": schedule_synced,
        "replayed": not newly_approved,
    }


async def reject_with_effects(
    db: AsyncSession,
    *,
    project_id: str,
    order_id: str,
    rejected_by: str,
) -> tuple[ChangeOrder | None, bool]:
    """Reject once and commit durable activity/notifications with the state."""
    query = select(ChangeOrder).where(
        ChangeOrder.id == order_id,
        ChangeOrder.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    order = (await db.execute(query)).scalar_one_or_none()
    if not order or order.status == ChangeOrderStatus.approved:
        return None, False
    if order.status == ChangeOrderStatus.rejected:
        await db.commit()
        return order, True

    order.status = ChangeOrderStatus.rejected
    project = await db.get(Project, project_id)
    effects = (
        await _prepare_rejection_side_effects(
            db,
            project=project,
            order=order,
            rejected_by=rejected_by,
        )
        if project
        else []
    )
    await db.commit()
    await db.refresh(order)
    activate_client_write_side_effects(effects)
    return order, False


async def reject(db: AsyncSession, order_id: str) -> ChangeOrder | None:
    """Compatibility path for callers that do not need delivery metadata."""
    order = await db.get(ChangeOrder, order_id)
    if not order:
        return None
    result, _ = await reject_with_effects(
        db,
        project_id=order.project_id,
        order_id=order.id,
        rejected_by=order.created_by,
    )
    return result
