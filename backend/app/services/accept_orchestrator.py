"""
Единый каскад приёмки этапа (W44).

Все входы (mobile WA, portal, будущие) обязаны вызывать finalize_work_acceptance,
чтобы side effects были одинаковыми: stage done → act → payment → next → events+notify.
Schedule item status=accepted НЕ должен обходить этот путь (см. project_work_schedule_service).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    AcceptanceStatus,
    Payment,
    PaymentType,
    Project,
    ProjectIssue,
    Stage,
    StageStatus,
    WorkAcceptance,
)
from app.services import activity_service as act
from app.services import notification_service as notif


@dataclass
class AcceptResult:
    acceptance: WorkAcceptance
    stage: Stage
    payment: Payment | None
    next_stage: Stage | None


def project_member_ids(project: Project) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for user_id in [project.customer_id, project.contractor_id, project.foreman_id]:
        if user_id and user_id not in seen:
            seen.add(user_id)
            result.append(user_id)
    return result


async def ensure_stage_payment(
    db: AsyncSession, project: Project, stage: Stage, created_by: str
) -> Payment | None:
    existing = (
        await db.execute(
            select(Payment)
            .where(Payment.project_id == project.id)
            .where(Payment.stage_id == stage.id)
            .where(Payment.payment_type == PaymentType.stage)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing or not stage.payment_amount or stage.payment_amount <= 0:
        return existing

    payment = Payment(
        project_id=project.id,
        stage_id=stage.id,
        payment_type=PaymentType.stage,
        title=f"Оплата этапа: {stage.name}",
        amount=stage.payment_amount,
        created_by=created_by,
        notes="Создано при приёмке этапа",
    )
    db.add(payment)
    return payment


async def activate_next_stage(db: AsyncSession, stage: Stage) -> Stage | None:
    next_stage = (
        await db.execute(
            select(Stage)
            .where(Stage.project_id == stage.project_id)
            .where(Stage.sort_order > stage.sort_order)
            .where(Stage.status == StageStatus.planned)
            .order_by(Stage.sort_order.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if next_stage:
        next_stage.status = StageStatus.active
        next_stage.actual_start = next_stage.actual_start or date.today()
    return next_stage


async def finalize_work_acceptance(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    row: WorkAcceptance,
    accepted_by: str,
    comment: str | None = None,
    quality_score: float | None = None,
    create_issue: bool = False,
    checklist: list[str] | None = None,
    with_remarks: bool = False,
) -> AcceptResult:
    """Мутации БД до commit. Не пишет events/notify — см. emit_acceptance_side_effects."""
    now = datetime.utcnow()
    status = (
        AcceptanceStatus.accepted_with_remarks.value
        if (create_issue or with_remarks)
        else AcceptanceStatus.accepted.value
    )
    # W68 #44: без фото результата приёмка блокируется (явный select — без lazy load в async)
    from sqlalchemy import select as _select
    from app.models.entities import StagePhoto
    photos = list(
        (await db.execute(_select(StagePhoto).where(StagePhoto.stage_id == stage.id))).scalars().all()
    )
    if not photos:
        raise ValueError("photos_required")

    row.status = status
    row.accepted_by = accepted_by
    row.accepted_at = now
    if quality_score is not None:
        row.quality_score = quality_score
    row.comment = comment or row.comment
    if checklist is not None:
        row.checklist_json = json.dumps(checklist)

    stage.status = StageStatus.done
    stage.customer_accepted_at = stage.customer_accepted_at or now
    stage.actual_end = stage.actual_end or date.today()
    stage.percent_complete = 100
    stage.needs_rework = False

    if create_issue:
        db.add(
            ProjectIssue(
                project_id=project.id,
                stage_id=stage.id,
                title=f"Замечание после приёмки: {stage.name}",
                description=comment,
                severity="low",
                status="open",
                created_at=now,
            )
        )

    payment = await ensure_stage_payment(db, project, stage, accepted_by)
    next_stage = await activate_next_stage(db, stage)

    from app.services.project_document_service import ensure_acceptance_act_document

    await ensure_acceptance_act_document(
        db,
        project_id=project.id,
        stage_id=stage.id,
        stage_name=stage.name,
        acceptance_id=row.id,
        accepted_by=accepted_by,
    )
    await db.flush()
    return AcceptResult(acceptance=row, stage=stage, payment=payment, next_stage=next_stage)


async def emit_acceptance_side_effects(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    accepted_by: str,
    comment: str | None,
    payment: Payment | None,
    next_stage: Stage | None,
    source: str = "app",
) -> None:
    """Events + notifications после commit строки приёмки. stage_id обязателен для automation."""
    title_suffix = " (портал)" if source == "portal" else ""
    await act.log_event(
        db,
        project_id=project.id,
        user_id=accepted_by,
        kind="AcceptancePassed",
        title=f"Этап принят{title_suffix}: {stage.name}",
        body=comment,
        link_path=f"/stage/{stage.id}",
        stage_id=stage.id,
    )
    await act.log_event(
        db,
        project_id=project.id,
        user_id=accepted_by,
        kind="StageClosed",
        title=f"Этап закрыт{title_suffix}: {stage.name}",
        body=comment,
        link_path=f"/stage/{stage.id}",
        stage_id=stage.id,
    )

    for member_id in project_member_ids(project):
        if member_id == accepted_by:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project.id,
            notification_type="stage_review",
            title=f"Этап принят: {stage.name}",
            body=comment or "Работы по этапу приняты заказчиком.",
            link_path=f"/stage/{stage.id}",
            return_to="/(customer)/(tabs)/home",
        )

    if payment and project.customer_id:
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=project.id,
            notification_type="payment_pending",
            title="Подтвердите оплату этапа",
            body=stage.name,
            link_path="/(customer)/(tabs)/budget?tab=payments",
            return_to="/(customer)/(tabs)/home",
        )

    # W68 #46: авто-акт уже создан ensure_acceptance_act_document — пушим в Документы
    for member_id in project_member_ids(project):
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project.id,
            notification_type="document",
            title=f"Акт приёмки готов: {stage.name}",
            body="PDF сформирован автоматически после приёмки",
            link_path="/documents",
            return_to="/(customer)/(tabs)/home" if member_id == project.customer_id else "/(contractor)/(tabs)/home",
        )

    if next_stage:
        for member_id in project_member_ids(project):
            await notif.notify(
                db,
                user_id=member_id,
                project_id=project.id,
                notification_type="stage_started",
                title=f"Следующий этап: {next_stage.name}",
                body="Этап автоматически переведён в работу после приёмки предыдущего.",
                link_path=f"/stage/{next_stage.id}",
                return_to="/(customer)/(tabs)/repair",
            )
