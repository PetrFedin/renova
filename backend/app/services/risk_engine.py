"""Risk Engine — выявление рисков по данным проекта."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Payment,
    PaymentStatus,
    Project,
    ProjectIssue,
    Purchase,
    PurchaseStatus,
    Stage,
    StageStatus,
)


def _rid(kind: str, key: str) -> str:
    return f"{kind}-{key}"


async def compute_project_risks(db: AsyncSession, project: Project) -> list[dict]:
    """Возвращает до 10 рисков с причиной, влиянием и действием."""
    today = date.today()
    risks: list[dict] = []

    stages = sorted(project.stages or [], key=lambda s: s.sort_order)
    progress = sum(s.percent_complete for s in stages) / (len(stages) or 1)

    # Бюджет / перерасход
    planned = project.budget_planned or 0
    spent = project.budget_spent or 0
    if planned > 0:
        forecast = spent + (planned - spent) * max(0, (100 - progress) / max(progress, 1)) if progress < 100 else spent
        overrun = forecast - planned
        if spent >= planned * 0.9 and progress < 85:
            risks.append({
                "id": _rid("budget", "pace"),
                "kind": "budget",
                "severity": "high",
                "title": "Бюджет опережает прогресс",
                "cause": f"Потрачено {round(spent/planned*100)}%, выполнено {round(progress)}%",
                "impact": f"Прогноз перерасхода {round(max(0, overrun))} ₽",
                "action": "Проверьте смету и расходы по комнатам",
                "href": "/(customer)/(tabs)/budget",
            })
        elif overrun > planned * 0.05:
            risks.append({
                "id": _rid("budget", "forecast"),
                "kind": "budget",
                "severity": "medium",
                "title": "Риск перерасхода",
                "cause": "Факт и темп работ выше плана",
                "impact": f"+{round(overrun)} ₽ к смете",
                "action": "Открыть бюджет",
                "href": "/(customer)/(tabs)/budget",
            })

    # Сроки
    overdue = [s for s in stages if s.planned_end and s.planned_end < today and s.status != StageStatus.done]
    for st in overdue[:2]:
        delay = (today - st.planned_end).days
        risks.append({
            "id": _rid("schedule", st.id),
            "kind": "schedule",
            "severity": "high" if delay > 3 else "medium",
            "title": f"Просрочка: {st.name}",
            "cause": f"Дедлайн {st.planned_end.isoformat()}",
            "impact": f"+{delay} дн. к графику",
            "action": "Открыть работу",
            "href": f"/stage/{st.id}",
        })

    if project.planned_end_date and today > project.planned_end_date and progress < 100:
        d = (today - project.planned_end_date).days
        risks.append({
            "id": _rid("schedule", "project"),
            "kind": "schedule",
            "severity": "critical" if d > 7 else "high",
            "title": "Проект просрочен",
            "cause": f"Плановое окончание {project.planned_end_date.isoformat()}",
            "impact": f"+{d} дн.",
            "action": "Проверить график",
            "href": "/(customer)/(tabs)/works",
        })


    # Зависимости работ
    from app.services import dependency_service as dep_svc
    for st in stages:
        if st.status not in (StageStatus.planned, StageStatus.active):
            continue
        ev = await dep_svc.evaluate_stage(db, st)
        if ev.get("blocked") and ev.get("reasons"):
            r0 = ev["reasons"][0]
            risks.append({
                "id": _rid("dependency", st.id),
                "kind": "materials" if r0.get("type") == "material" else "schedule",
                "severity": r0.get("severity", "high"),
                "title": f"Блокировка: {st.name}",
                "cause": r0.get("title", "Зависимость не выполнена"),
                "impact": "Работа не может стартовать",
                "action": "Устранить зависимость",
                "href": f"/stage/{st.id}",
            })
            break

    # Материалы
    picks_r = await db.execute(select(MaterialPick).where(MaterialPick.project_id == project.id))
    picks = list(picks_r.scalars().all())
    need_buy = [p for p in picks if p.status in (MaterialPickStatus.draft, MaterialPickStatus.pending)]
    if need_buy:
        risks.append({
            "id": _rid("materials", "buy"),
            "kind": "materials",
            "severity": "medium",
            "title": "Материалы не заказаны",
            "cause": f"{len(need_buy)} поз. ждут закупки",
            "impact": "Задержка старта работ",
            "action": "Создать закупку",
            "href": "/(customer)/(tabs)/materials",
        })

    for st in stages:
        if st.status == StageStatus.active and st.planned_start and st.planned_start <= today:
            linked = [p for p in picks if p.stage_id == st.id and p.status != MaterialPickStatus.purchased]
            if linked:
                risks.append({
                    "id": _rid("materials", st.id),
                    "kind": "materials",
                    "severity": "high",
                    "title": f"Нет материалов: {st.name}",
                    "cause": f"{len(linked)} поз. не доставлены",
                    "impact": "Работа может встать",
                    "action": "Заказать материалы",
                    "href": "/(customer)/(tabs)/materials",
                })
                break

    # Качество / приёмка
    review = [s for s in stages if s.status == StageStatus.review]
    if review:
        risks.append({
            "id": _rid("quality", "review"),
            "kind": "quality",
            "severity": "medium",
            "title": "Ждёт приёмки",
            "cause": f"{len(review)} этап(ов) на проверке",
            "impact": "Блокирует оплату и следующие работы",
            "action": "Принять этап",
            "href": f"/stage/{review[0].id}",
        })

    rework = [s for s in stages if s.needs_rework]
    if rework:
        risks.append({
            "id": _rid("quality", "rework"),
            "kind": "quality",
            "severity": "high",
            "title": "Открыта доработка",
            "cause": f"{len(rework)} этап(ов) возвращены",
            "impact": "Снижает индекс качества",
            "action": "Открыть контроль",
            "href": "/(customer)/(tabs)/control",
        })

    # Issues из таблицы project_issues
    try:
        ir = await db.execute(
            select(ProjectIssue).where(
                ProjectIssue.project_id == project.id,
                ProjectIssue.status.in_(["open", "assigned", "in_progress"]),
            )
        )
        issues = list(ir.scalars().all())
        critical = [i for i in issues if i.severity in ("high", "critical")]
        for iss in critical[:2]:
            risks.append({
                "id": _rid("quality", iss.id),
                "kind": "quality",
                "severity": iss.severity,
                "title": iss.title,
                "cause": iss.description or "Замечание не закрыто",
                "impact": f"Срок: {iss.due_at.date().isoformat()}" if iss.due_at else "Требует исправления",
                "action": "Закрыть замечание",
                "href": "/(customer)/(tabs)/control",
            })
        stale = [i for i in issues if i.created_at < datetime.utcnow() - timedelta(days=3)]
        if stale and not critical:
            risks.append({
                "id": _rid("quality", "stale"),
                "kind": "quality",
                "severity": "medium",
                "title": "Замечания без движения",
                "cause": f"{len(stale)} открыты > 3 дней",
                "impact": "Риск эскалации",
                "action": "Проверить замечания",
                "href": "/(customer)/(tabs)/control",
            })
    except Exception:
        pass

    # Оплаты
    pending = [p for p in (project.payments or []) if p.status == PaymentStatus.pending]
    blocked = []
    for pay in pending:
        if pay.stage_id:
            st = next((s for s in stages if s.id == pay.stage_id), None)
            if st and not st.customer_accepted_at:
                blocked.append(pay)
    if blocked:
        risks.append({
            "id": _rid("payment", "blocked"),
            "kind": "payment",
            "severity": "medium",
            "title": "Оплата без приёмки",
            "cause": f"{len(blocked)} платеж(ей) ждут приёмки этапа",
            "impact": "Нельзя подтвердить оплату",
            "action": "Принять этап",
            "href": "/(customer)/(tabs)/control",
        })
    elif pending:
        risks.append({
            "id": _rid("payment", "pending"),
            "kind": "payment",
            "severity": "low",
            "title": "Ожидает оплаты",
            "cause": f"{len(pending)} платеж(ей)",
            "impact": "Подрядчик ждёт подтверждения",
            "action": "Утвердить оплату",
            "href": "/(customer)/(tabs)/budget",
        })

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    risks.sort(key=lambda r: order.get(r["severity"], 9))
    return risks[:10]


async def load_project_for_risks(db: AsyncSession, project_id: str) -> Project | None:
    r = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.stages), selectinload(Project.payments))
    )
    return r.scalar_one_or_none()
