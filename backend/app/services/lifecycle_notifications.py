"""Уведомления о событиях жизненного цикла проекта, которые раньше молчали (COM-021).

Каждое уведомление ставится в durable-outbox один раз на (событие, получатель):
повтор запроса, повторный проход воркера и ретрай ничего не дублируют. Ссылки
пишутся в маршрутах роли получателя — `notify` приводит их к его группе
(`notification_links.link_for_role`).
"""
from __future__ import annotations

from app.core.money_format import format_rub
import logging
from datetime import timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox, Payment, PaymentStatus, Project
from app.services import notification_recipients as recipients_svc
from app.services.automation_reminder_outbox import (
    enqueue_notification_once,
    reminder_outbox_id,
)

logger = logging.getLogger(__name__)

INVOICE_REMINDER_MIN_AGE = timedelta(days=3)
INVOICE_REMINDER_INTERVAL = timedelta(days=3)
INVOICE_REMINDER_MAX = 3

_CUSTOMER = "/(customer)/(tabs)/"
_CONTRACTOR = "/(contractor)/(tabs)/"


def _return_to(role: str | None) -> str:
    return _CONTRACTOR if role == "contractor" else _CUSTOMER


async def notify_once(
    db: AsyncSession,
    *,
    dedupe_key: str,
    user_ids: Iterable[str | None],
    project_id: str,
    notification_type: str,
    title: str,
    body: str,
    link_path: str,
    return_to: str | None = None,
    commit: bool = True,
) -> int:
    """Поставить по одному уведомлению каждому получателю; вернуть число новых."""
    created = 0
    for user_id in sorted({u for u in user_ids if u}):
        if await enqueue_notification_once(
            db,
            dedupe_key=f"{dedupe_key}:{user_id}",
            project_id=project_id,
            user_id=user_id,
            notification_type=notification_type,
            title=title,
            body=body,
            link_path=link_path,
            return_to=return_to,
        ):
            created += 1
    if commit:
        await db.commit()
        if created:
            from app.services.outbox_inline_dispatch import dispatch_best_effort

            await dispatch_best_effort(db, source="lifecycle.notify", limit=max(10, created * 2))
    return created


async def notify_contractor_assigned(
    db: AsyncSession, *, project_id: str, contractor_id: str, actor_id: str | None
) -> int:
    """Заказчик назначил исполнителя: исполнитель узнаёт, что объект теперь его."""
    project = await db.get(Project, project_id)
    if project is None or contractor_id == actor_id:
        return 0
    day = utc_now().date().isoformat()
    return await notify_once(
        db,
        dedupe_key=f"contractor-assigned:{project_id}:{contractor_id}:{day}",
        user_ids=[contractor_id],
        project_id=project_id,
        notification_type="approval",
        title="Вас назначили исполнителем",
        body=f"Объект «{project.name}»: заказчик назначил вас ведущим исполнителем.",
        link_path="/(contractor)/(tabs)/",
        return_to=_CONTRACTOR,
    )


async def notify_lead_converted(
    db: AsyncSession, *, project_id: str, lead_id: str, actor_id: str, created: bool
) -> int:
    """Заявка биржи стала проектом: вторая сторона узнаёт, что объект создан."""
    if not created:
        return 0
    project = await db.get(Project, project_id)
    if project is None:
        return 0
    targets = {project.customer_id, project.contractor_id} - {actor_id, None}
    return await notify_once(
        db,
        dedupe_key=f"lead-converted:{lead_id}",
        user_ids=targets,
        project_id=project_id,
        notification_type="approval",
        title="Заявка стала объектом",
        body=f"По заявке «{project.name}» создан объект. Откройте его и начните работу.",
        link_path="/(customer)/(tabs)/",
        return_to=_CUSTOMER,
    )


async def scan_unpaid_invoice_reminders(
    db: AsyncSession, project: Project, *, now=None
) -> list[str]:
    """Напомнить заказчику о неоплаченных счетах: не чаще раза в 3 дня, не более 3 раз.

    Счёт — `Payment` в статусе pending. Номер напоминания n — часть ключа
    дедупликации, а «последнее напоминание» берётся из `created_at` строки
    durable-outbox предыдущего номера: отдельное хранилище (миграция) не нужно.
    """
    if not project.customer_id or project.trashed_at is not None:
        return []
    now = now or utc_now()
    rows = (
        await db.execute(
            select(Payment).where(
                Payment.project_id == project.id,
                Payment.status == PaymentStatus.pending,
            )
        )
    ).scalars().all()
    actions: list[str] = []
    for payment in rows:
        if payment.created_by == project.customer_id:
            continue  # счёт выставил сам заказчик — напоминать ему о своём не нужно
        if now - payment.created_at < INVOICE_REMINDER_MIN_AGE:
            continue
        last_sent = None
        sent = 0
        for n in range(1, INVOICE_REMINDER_MAX + 1):
            row = await db.get(
                DomainOutbox,
                reminder_outbox_id(f"invoice-reminder:{payment.id}:{n}:{project.customer_id}"),
            )
            if row is None:
                break
            sent, last_sent = n, row.created_at
        if sent >= INVOICE_REMINDER_MAX:
            continue
        if last_sent is not None and now - last_sent < INVOICE_REMINDER_INTERVAL:
            continue
        n = sent + 1
        if await enqueue_notification_once(
            db,
            dedupe_key=f"invoice-reminder:{payment.id}:{n}:{project.customer_id}",
            project_id=project.id,
            user_id=project.customer_id,
            notification_type="payment_pending",
            title="Счёт ждёт оплаты",
            body=f"{payment.title}: {format_rub(payment.amount)}. Оплатите или отметьте перевод.",
            link_path="/(customer)/(tabs)/budget?tab=payments",
            return_to=_CUSTOMER,
        ):
            actions.append(f"invoice_reminder:{payment.id}:{n}")
    return actions
