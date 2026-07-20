"""Rule-based AI Copilot — рекомендации без LLM (Renova OS moat)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import MaterialPick, MaterialPickStatus, Payment, PaymentStatus, Project, Stage, StageStatus
from app.services import dependency_service as dep_svc
from app.services import schedule_service as sched_svc


def _insight(
    *,
    id: str,
    kind: str,
    title: str,
    body: str,
    probability: int | None = None,
    action: str,
    href: str,
    priority: int = 50,
) -> dict:
    return {
        "id": id,
        "kind": kind,
        "title": title,
        "body": body,
        "probability": probability,
        "action": action,
        "href": href,
        "priority": priority,
    }


async def compute_project_insights(db: AsyncSession, project: Project, *, role: str = "customer") -> list[dict]:
    """До 6 actionable insights — сортировка по priority."""
    today = date.today()
    insights: list[dict] = []
    stages = sorted(project.stages or [], key=lambda s: s.sort_order)
    progress = sum(s.percent_complete for s in stages) / (len(stages) or 1)
    planned = project.budget_planned or 0
    spent = project.budget_spent or 0

    # 1. Вероятность перерасхода бюджета
    if planned > 0:
        pace_ratio = (spent / planned) / max(progress / 100, 0.05)
        prob = min(95, max(0, int((pace_ratio - 1) * 60 + (spent / planned) * 40))) if pace_ratio > 0.85 else int(max(0, (spent / planned - progress / 100) * 100))
        if prob >= 35:
            insights.append(_insight(
                id="budget-overrun-prob",
                kind="budget",
                title=f"Вероятность перерасхода: {prob}%",
                body=f"Потрачено {round(spent/planned*100)}% бюджета при {round(progress)}% готовности.",
                probability=prob,
                action="Открыть бюджет",
                href="/(customer)/(tabs)/budget" if role != "contractor" else "/(contractor)/(tabs)/budget",
                priority=70 + min(20, prob // 5),
            ))

    # 2. Прогноз задержки
    sched = await sched_svc.build_schedule_summary(db, project)
    if sched.get("forecast_delay_days", 0) > 2:
        insights.append(_insight(
            id="schedule-delay",
            kind="schedule",
            title="Риск задержки проекта",
            body=f"Прогноз окончания +{sched['forecast_delay_days']} дн. к плану.",
            probability=min(90, 40 + sched["forecast_delay_days"] * 5),
            action="График работ",
            href="/(customer)/(tabs)/works" if role != "contractor" else "/(contractor)/(tabs)/works",
            priority=65,
        ))

    # 3. Оплата заблокирована — приёмка
    review = [s for s in stages if s.status == StageStatus.review]
    if review and role == "customer":
        insights.append(_insight(
            id="payment-blocked-acceptance",
            kind="payment",
            title="Нельзя оплачивать без приёмки",
            body=f"«{review[0].name}» ждёт проверки — оплата откроется после приёмки.",
            action="Принять работу",
            href=f"/stage/{review[0].id}",
            priority=85,
        ))

    # 4. Материалы скоро понадобятся
    picks_r = await db.execute(select(MaterialPick).where(MaterialPick.project_id == project.id))
    picks = list(picks_r.scalars().all())
    need = [p for p in picks if p.status in (MaterialPickStatus.draft, MaterialPickStatus.pending)]
    active_stages = [s for s in stages if s.status == StageStatus.active]
    if need and active_stages:
        insights.append(_insight(
            id="materials-soon",
            kind="materials",
            title=f"Закупите материалы: {len(need)} поз.",
            body=f"Для «{active_stages[0].name}» могут понадобиться материалы в ближайшие дни.",
            action="К закупке",
            href="/(customer)/(tabs)/repair?tab=materials" if role != "contractor" else "/(contractor)/(tabs)/repair?tab=materials",
            priority=60,
        ))

    # 5. Последовательность работ (dependency)
    for st in stages:
        if st.status not in (StageStatus.planned, StageStatus.active):
            continue
        ev = await dep_svc.evaluate_stage(db, st)
        if ev.get("blocked") and ev.get("reasons"):
            r0 = ev["reasons"][0]
            insights.append(_insight(
                id=f"sequence-{st.id}",
                kind="sequence",
                title="Сначала завершите зависимость",
                body=f"«{st.name}»: {r0.get('title', 'есть блокировка')}.",
                action="Подробнее",
                href=f"/stage/{st.id}",
                priority=75,
            ))
            break

    # 6. Просроченные работы
    overdue = [s for s in stages if s.planned_end and s.planned_end < today and s.status != StageStatus.done]
    if overdue:
        st = overdue[0]
        d = (today - st.planned_end).days
        insights.append(_insight(
            id=f"overdue-{st.id}",
            kind="schedule",
            title=f"Просрочка: {st.name}",
            body=f"+{d} дн. к дедлайну {st.planned_end.isoformat()}.",
            action="Открыть",
            href=f"/stage/{st.id}",
            priority=80,
        ))

    # 7. Pending payments for customer
    if role == "customer":
        pay_r = await db.execute(
            select(Payment).where(Payment.project_id == project.id, Payment.status == PaymentStatus.pending)
        )
        pending = list(pay_r.scalars().all())
        if pending:
            insights.append(_insight(
                id="payments-pending",
                kind="payment",
                title=f"Ожидает оплаты: {len(pending)}",
                body="Подтвердите оплату после приёмки работ.",
                action="Бюджет",
                href="/(customer)/(tabs)/budget",
                priority=55,
            ))

    insights.sort(key=lambda x: -x["priority"])
    return insights[:6]
