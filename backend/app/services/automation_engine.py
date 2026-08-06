"""Automation Engine — правила цепочки: работа → приёмка → оплата → закупка."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Project,
    Stage,
    StageStatus,
)
from app.services import outbox_service
from app.services.automation_reminder_outbox import enqueue_notification_once


async def _enqueue_event_notification(
    db: AsyncSession,
    *,
    effect_key: str,
    aggregate_id: str,
    parent_outbox_id: str | None,
    user_id: str,
    project_id: str,
    notification_type: str,
    title: str,
    body: str,
    link_path: str | None = None,
    return_to: str | None = None,
) -> None:
    """Prepare one automation notification without performing external delivery."""
    payload = {
        "user_id": user_id,
        "project_id": project_id,
        "notification_type": notification_type,
        "title": title,
        "body": body,
        "link_path": link_path,
        "return_to": return_to,
    }
    if parent_outbox_id:
        await outbox_service.enqueue_once(
            db,
            parent_outbox_id=parent_outbox_id,
            effect_key=f"automation:{effect_key}",
            aggregate_type="activity_automation",
            aggregate_id=aggregate_id,
            event_type=outbox_service.NOTIFICATION_EVENT,
            payload=payload,
        )
        return

    await outbox_service.enqueue(
        db,
        aggregate_type="activity_automation",
        aggregate_id=aggregate_id,
        event_type=outbox_service.NOTIFICATION_EVENT,
        payload=payload,
    )


async def prepare_event_effects(
    db: AsyncSession,
    *,
    kind: str,
    project_id: str,
    user_id: str | None = None,
    stage_id: str | None = None,
    body: str | None = None,
    room_id: str | None = None,
    source_activity_id: str | None = None,
    parent_outbox_id: str | None = None,
) -> list[str]:
    """Prepare deterministic event-driven effects in the caller's transaction."""
    actions: list[str] = []
    project = await db.get(Project, project_id)
    aggregate_id = source_activity_id or parent_outbox_id or project_id

    # Работа завершена → запрос приёмки
    if kind in ("WorkCompleted", "stage_review", "InspectionRequested") and stage_id:
        stage = await db.get(Stage, stage_id)
        if stage and stage.status == StageStatus.review:
            actions.append("inspection_requested")
            if project and project.customer_id and kind != "InspectionRequested":
                await _enqueue_event_notification(
                    db,
                    effect_key=f"stage-review:{project.customer_id}",
                    aggregate_id=aggregate_id,
                    parent_outbox_id=parent_outbox_id,
                    user_id=project.customer_id,
                    project_id=project_id,
                    notification_type="stage_review",
                    title="Нужна приёмка",
                    body=stage.name,
                    link_path=f"/stage/{stage.id}",
                    return_to="/(customer)/(tabs)/repair?tab=control",
                )

    # Приёмка пройдена → оплата разрешена
    if kind == "StageClosed" and stage_id:
        actions.append("stage_closed_cascade")
        if project:
            actions.append("project_progress_updated")

    if kind == "StageStarted" and stage_id:
        actions.append("stage_started")

    if kind in ("AcceptancePassed", "AcceptanceAccepted") and stage_id:
        actions.append("payment_allowed")
        stage = await db.get(Stage, stage_id)
        if project and project.customer_id and stage:
            await _enqueue_event_notification(
                db,
                effect_key=f"payment-unlocked:{project.customer_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="payment_pending",
                title="Можно оплатить этап",
                body=f"«{stage.name}» принят — подтвердите оплату.",
                link_path="/(customer)/(tabs)/budget",
                return_to="/(customer)/(tabs)/budget",
            )
            actions.append("payment_unlock_notified")

    # Попытка оплаты без приёмки
    if kind == "PaymentBlocked" and stage_id:
        stage = await db.get(Stage, stage_id)
        if project and project.customer_id and stage:
            await _enqueue_event_notification(
                db,
                effect_key=f"payment-blocked:{project.customer_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="payment_pending",
                title="Оплата заблокирована",
                body=f"Сначала примите «{stage.name}» — без приёмки оплата недоступна.",
                link_path=f"/stage/{stage.id}",
                return_to=f"/stage/{stage.id}",
            )
            actions.append("payment_blocked_notified")

    # Материалы доставлены → разблокировка зависимых работ
    if kind == "MaterialDelivered":
        actions.append("dependent_work_unlocked")
        if project and project.contractor_id:
            await _enqueue_event_notification(
                db,
                effect_key=f"material-delivered:{project.contractor_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.contractor_id,
                project_id=project_id,
                notification_type="material",
                title="Материалы доставлены",
                body=body or "Можно продолжать работы",
                link_path="/(contractor)/(tabs)/repair?tab=materials",
                return_to="/(contractor)/(tabs)/repair?tab=materials",
            )

    # Расчёт материалов → напоминание о закупке
    if kind == "MaterialCalculated" and room_id:
        actions.append("purchase_suggested")
        if project and project.customer_id:
            await _enqueue_event_notification(
                db,
                effect_key=f"material-calculated:{project.customer_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="material",
                title="Список материалов готов",
                body=body or "Добавьте позиции в закупки",
                link_path="/(customer)/(tabs)/repair?tab=materials",
                return_to=f"/room/{room_id}",
            )

    # Замечание → риск качества
    if kind == "IssueCreated":
        actions.append("quality_risk_updated")
        if body in ("critical", "high") and project and project.contractor_id:
            await _enqueue_event_notification(
                db,
                effect_key=f"critical-issue:{project.contractor_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.contractor_id,
                project_id=project_id,
                notification_type="issue",
                title="Критичное замечание",
                body="Требуется реакция на объекте",
                link_path="/(contractor)/(tabs)/repair?tab=control",
                return_to="/(contractor)/(tabs)/repair?tab=control",
            )

    # Расход → проверка перерасхода бюджета
    if kind == "ExpenseAdded" and project:
        planned = project.budget_planned or 0
        spent = project.budget_spent or 0
        if planned > 0 and spent / planned >= 0.9:
            actions.append("budget_alert")
            if project.customer_id:
                pct = int(spent / planned * 100)
                await _enqueue_event_notification(
                    db,
                    effect_key=f"budget-alert:{project.customer_id}",
                    aggregate_id=aggregate_id,
                    parent_outbox_id=parent_outbox_id,
                    user_id=project.customer_id,
                    project_id=project_id,
                    notification_type="budget",
                    title=f"Бюджет: {pct}% использовано",
                    body="Проверьте смету — риск перерасхода.",
                    link_path="/(customer)/(tabs)/budget",
                    return_to="/(customer)/(tabs)/budget",
                )

    # Event-driven fallback. Periodic scans use the durable outbox below.
    if kind == "schedule_overdue" and stage_id:
        stage = await db.get(Stage, stage_id)
        if stage and project and project.contractor_id:
            await _enqueue_event_notification(
                db,
                effect_key=f"schedule-overdue:{project.contractor_id}",
                aggregate_id=aggregate_id,
                parent_outbox_id=parent_outbox_id,
                user_id=project.contractor_id,
                project_id=project_id,
                notification_type="deadline",
                title="Просрочка работы",
                body=stage.name,
                link_path=f"/stage/{stage.id}",
                return_to="/(contractor)/(tabs)/repair?tab=works",
            )
            actions.append("overdue_notified")

    return actions


async def process_event(
    db: AsyncSession,
    *,
    kind: str,
    project_id: str,
    user_id: str | None = None,
    stage_id: str | None = None,
    body: str | None = None,
    room_id: str | None = None,
) -> list[str]:
    """Compatibility entrypoint: durably enqueue effects, then accelerate delivery."""
    actions = await prepare_event_effects(
        db,
        kind=kind,
        project_id=project_id,
        user_id=user_id,
        stage_id=stage_id,
        body=body,
        room_id=room_id,
    )
    await db.commit()
    from app.services import outbox_inline_dispatch

    await outbox_inline_dispatch.dispatch_best_effort(
        db,
        source="automation.process_event",
        limit=10,
    )
    return actions


async def scan_project_reminders(
    db: AsyncSession,
    project: Project,
    *,
    on_date: date | None = None,
) -> list[str]:
    """Enqueue daily project reminders once across all worker instances."""
    actions: list[str] = []
    today = on_date or utc_now().date()
    day_key = today.isoformat()
    stages = sorted(project.stages or [], key=lambda stage: stage.sort_order)

    for stage in stages:
        if (
            stage.planned_end
            and stage.planned_end < today
            and stage.status not in (StageStatus.done,)
            and project.contractor_id
        ):
            created = await enqueue_notification_once(
                db,
                dedupe_key=f"schedule-overdue:{stage.id}:{project.contractor_id}:{day_key}",
                project_id=project.id,
                user_id=project.contractor_id,
                notification_type="deadline",
                title="Просрочка работы",
                body=stage.name,
                link_path=f"/stage/{stage.id}",
                return_to="/(contractor)/(tabs)/repair?tab=works",
            )
            if created:
                actions.append(f"overdue:{stage.id}")

    active = [stage for stage in stages if stage.status == StageStatus.active]
    if active and project.customer_id:
        picks_result = await db.execute(
            select(MaterialPick).where(MaterialPick.project_id == project.id)
        )
        need = [
            pick
            for pick in picks_result.scalars().all()
            if pick.status in (MaterialPickStatus.draft, MaterialPickStatus.pending)
        ]
        if need:
            created = await enqueue_notification_once(
                db,
                dedupe_key=f"materials:{project.id}:{project.customer_id}:{day_key}",
                project_id=project.id,
                user_id=project.customer_id,
                notification_type="material",
                title=f"Закупите материалы ({len(need)})",
                body=f"Для «{active[0].name}» нужны материалы",
                link_path="/(customer)/(tabs)/repair?tab=materials",
                return_to="/(customer)/(tabs)/repair?tab=materials",
            )
            if created:
                actions.append("materials_reminder")

    return actions
