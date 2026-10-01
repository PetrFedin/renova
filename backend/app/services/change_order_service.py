"""Change orders — доп. работы с согласованием заказчиком."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChangeOrder, ChangeOrderStatus, Payment, Project
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.services.budget_service import apply_change_order_to_budget, sync_project_budget_planned
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects

CHANGE_ORDER_FINAL_STATE_CONFLICT = "change_order_final_state_conflict"


class ChangeOrderFinalStateConflict(ValueError):
    """The order already resolved to the opposite terminal state.

    This is distinct from a missing/foreign order: the row exists and is
    owned by this project, but a prior decision already moved it to the
    other terminal status, so this decision cannot apply. Callers should
    surface this as 409, not 404.
    """

    def __init__(self) -> None:
        super().__init__(CHANGE_ORDER_FINAL_STATE_CONFLICT)


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
    stage_id: str | None = None,
) -> ChangeOrder:
    order = ChangeOrder(
        project_id=project_id,
        title=title,
        amount=amount,
        description=description,
        stage_id=stage_id,
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


async def linked_payment(db: AsyncSession, order_id: str) -> Payment | None:
    """Счёт допработы: настоящая связь `Payment.change_order_id` (MNY-020)."""
    return (
        await db.execute(
            select(Payment)
            .where(Payment.change_order_id == order_id)
            .order_by(Payment.created_at.asc(), Payment.id.asc())
            .limit(1)
        )
    ).scalars().first()


async def payments_by_order(db: AsyncSession, project_id: str) -> dict[str, Payment]:
    """order_id -> счёт допработы для всех допработ проекта."""
    result = await db.execute(
        select(Payment)
        .where(Payment.project_id == project_id, Payment.change_order_id.is_not(None))
        .order_by(Payment.created_at.asc(), Payment.id.asc())
    )
    mapping: dict[str, Payment] = {}
    for payment in result.scalars().all():
        mapping.setdefault(payment.change_order_id, payment)
    return mapping


async def _ensure_order_payment(
    db: AsyncSession, *, order: ChangeOrder, created_by: str
) -> Payment:
    """Один счёт на согласованную допработу (повтор не создаёт второй)."""
    from app.services.payment_service import prepare_payment

    existing = await linked_payment(db, order.id)
    if existing:
        return existing
    return await prepare_payment(
        db,
        order.project_id,
        created_by,
        f"Оплата доп. работ: {order.title}"[:255],
        float(order.amount),
        "advance",
        order.stage_id,
        "доп. работы",
        change_order_id=order.id,
    )


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
                "return_to": "/(contractor)/(tabs)/",
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
                "return_to": "/(contractor)/(tabs)/",
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
    if not order:
        return None, None
    if order.status == ChangeOrderStatus.rejected:
        await db.rollback()
        raise ChangeOrderFinalStateConflict()

    existing_document = await _linked_document(db, order.id)
    if order.status == ChangeOrderStatus.approved and existing_document:
        existing_payment = await linked_payment(db, order.id)
        await db.commit()
        return order, {
            "id": existing_document.id,
            "title": existing_document.title,
            "status": existing_document.status,
            "payment_id": existing_payment.id if existing_payment else None,
            "payment_status": existing_payment.status.value if existing_payment else None,
            "stage_id": order.stage_id,
            "schedule_synced": False,
            "replayed": True,
        }

    newly_approved = order.status == ChangeOrderStatus.pending
    if newly_approved:
        order.status = ChangeOrderStatus.approved

    await apply_change_order_to_budget(db, order)
    await sync_project_budget_planned(db, order.project_id)
    payment = await _ensure_order_payment(db, order=order, created_by=created_by)

    from app.services import project_document_service as documents

    draft = existing_document
    if not draft:
        draft = await documents.create_document(
            db,
            project_id=project_id,
            created_by=created_by,
            title=f"Доп. работы: {order.title}",
            # Не «contract»: документ допработ не основной договор и в гейт
            # начала работ не входит (DOC-003/006/007).
            document_type=DocumentType.addendum.value,
            change_order_id=order.id,
            notes=f"сумма {order.amount:.0f} ₽; черновик для подписи",
            # Содержание нужно, иначе подписать нельзя (contract_has_no_content):
            # документ рисуется по данным change order.
            href=f"/api/v1/projects/{project_id}/change-orders/{order.id}/document.pdf",
            mime_type="application/pdf",
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
        "payment_id": payment.id,
        "payment_status": payment.status.value,
        "stage_id": order.stage_id,
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
    if not order:
        return None, False
    if order.status == ChangeOrderStatus.approved:
        await db.rollback()
        raise ChangeOrderFinalStateConflict()
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
