"""Уведомления биржи заявок (MKT-006).

У заявки нет проекта, поэтому уведомления ставятся в durable-outbox с
``project_id=None`` и агрегатом-заявкой. Каждое событие — один раз на получателя
(детерминированный ключ), ссылки ведут на реальный маршрут ``/job-leads``, а
группу роли получателя подставляет ``notify_from_outbox`` (``link_for_role``).

Приватность: проигравшим исполнителям никогда не раскрывается ни цена победителя,
ни его личность — только факт, что заявка закрыта.
"""
from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import JobLead, JobLeadQuote
from app.services.automation_reminder_outbox import enqueue_notification_once

logger = logging.getLogger(__name__)

LEAD_LINK = "/job-leads"
_RETURN_TO = "/(customer)/(tabs)/"  # notify_from_outbox переведёт в группу роли получателя
_MESSAGE_WINDOW_SECONDS = 15 * 60


async def _send(
    db: AsyncSession,
    *,
    lead_id: str,
    dedupe_key: str,
    user_ids: Iterable[str | None],
    notification_type: str,
    title: str,
    body: str,
) -> int:
    created = 0
    for user_id in sorted({u for u in user_ids if u}):
        if await enqueue_notification_once(
            db,
            dedupe_key=f"{dedupe_key}:{user_id}",
            project_id=None,
            aggregate_id=lead_id,
            user_id=user_id,
            notification_type=notification_type,
            title=title,
            body=body,
            link_path=LEAD_LINK,
            return_to=_RETURN_TO,
        ):
            created += 1
    await db.commit()
    if created:
        from app.services.outbox_inline_dispatch import dispatch_best_effort

        await dispatch_best_effort(db, source="marketplace.notify", limit=max(10, created * 2))
    return created


def _rub(value: float) -> str:
    return f"{value:,.0f}".replace(",", " ") + " ₽"


async def notify_quote_received(db: AsyncSession, *, lead: JobLead, quote: JobLeadQuote) -> int:
    """Новый (или обновлённый по цене) отклик — заказчику. Цена своя для заказчика."""
    return await _send(
        db,
        lead_id=lead.id,
        dedupe_key=f"lead-quote:{quote.id}:{int(round(quote.pre_estimate * 100))}",
        user_ids=[lead.customer_id],
        notification_type="approval",
        title="Новый отклик на заявку",
        body=f"По заявке «{lead.title}» пришло КП на {_rub(quote.pre_estimate)}. Выберите исполнителя.",
    )


async def notify_quote_decision(
    db: AsyncSession, *, lead: JobLead, winner_id: str
) -> int:
    """Выбран исполнитель: ему — «принято», остальным откликнувшимся — «закрыта».

    Тексты проигравшим не содержат цены и имени победителя.
    """
    losers = list(
        (
            await db.execute(
                select(JobLeadQuote.contractor_id).where(
                    JobLeadQuote.lead_id == lead.id, JobLeadQuote.contractor_id != winner_id
                )
            )
        ).scalars().all()
    )
    sent = await _send(
        db,
        lead_id=lead.id,
        dedupe_key=f"lead-accepted:{lead.id}",
        user_ids=[winner_id],
        notification_type="approval",
        title="Ваше КП принято",
        body=f"Заказчик выбрал вас по заявке «{lead.title}». Он создаст объект — следите за чатом заявки.",
    )
    if losers:
        sent += await _send(
            db,
            lead_id=lead.id,
            dedupe_key=f"lead-lost:{lead.id}",
            user_ids=losers,
            notification_type="other",
            title="Заявка закрыта",
            body=f"По заявке «{lead.title}» заказчик выбрал другого исполнителя.",
        )
    return sent


async def notify_lead_closed(db: AsyncSession, *, lead: JobLead) -> int:
    """Заявка закрыта заказчиком: откликнувшимся — причина (если указана), без цен и имён."""
    contractor_ids = set(
        (await db.execute(select(JobLeadQuote.contractor_id).where(JobLeadQuote.lead_id == lead.id))).scalars().all()
    )
    if lead.assigned_contractor_id:
        contractor_ids.add(lead.assigned_contractor_id)
    if not contractor_ids:
        return 0
    reason = (lead.closed_reason or "").strip()
    if len(reason) > 200:
        reason = reason[:197] + "…"
    body = f"Заказчик закрыл заявку «{lead.title}»."
    body += f" Причина: {reason}" if reason else " Причина не указана."
    return await _send(
        db,
        lead_id=lead.id,
        dedupe_key=f"lead-closed:{lead.id}",
        user_ids=contractor_ids,
        notification_type="other",
        title="Заявка закрыта заказчиком",
        body=body,
    )


async def notify_lead_message(
    db: AsyncSession,
    *,
    lead: JobLead,
    sender_id: str,
    text: str,
    thread_contractor_id: str | None = None,
) -> int:
    """Сообщение в треде заявки — второй стороне треда (не чаще раза в 15 минут на тред).

    Тред — «заказчик ↔ исполнитель `thread_contractor_id`»: заказчику пишет тот самый
    исполнитель, исполнителю — заказчик; другие исполнители не уведомляются.
    """
    thread = thread_contractor_id or lead.assigned_contractor_id
    if sender_id == lead.customer_id:
        recipient = thread
    else:
        recipient = lead.customer_id
    if not recipient or recipient == sender_id:
        return 0
    bucket = int(utc_now().timestamp() // _MESSAGE_WINDOW_SECONDS)
    snippet = text.strip()
    snippet = snippet if len(snippet) <= 80 else snippet[:77] + "…"
    return await _send(
        db,
        lead_id=lead.id,
        dedupe_key=f"lead-message:{lead.id}:{thread or '-'}:{sender_id}:{bucket}",
        user_ids=[recipient],
        notification_type="chat_message",
        title=f"Сообщение по заявке «{lead.title}»",
        body=snippet,
    )


async def notify_conversion_blocked_by_limit(db: AsyncSession, *, lead_id: str) -> int:
    """Исполнителю — почему объект не создан: лимит бесплатного тарифа (раз в сутки)."""
    lead = await db.get(JobLead, lead_id)
    if lead is None or not lead.assigned_contractor_id:
        return 0
    day = utc_now().date().isoformat()
    return await _send(
        db,
        lead_id=lead.id,
        dedupe_key=f"lead-limit:{lead.id}:{day}",
        user_ids=[lead.assigned_contractor_id],
        notification_type="approval",
        title="Объект по заявке не создан",
        body=(
            f"Заказчик принял ваше КП по заявке «{lead.title}», но достигнут лимит бесплатного "
            "тарифа. Оформите Pro, чтобы принять объект."
        ),
    )
