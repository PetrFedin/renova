"""Schedule Renova OS — сроки, задержки, прогноз окончания."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import MaterialPick, Project, Purchase, Stage, StageStatus


def _today() -> date:
    return date.today()


def _stage_delay_days(stage: Stage, today: date | None = None) -> int:
    today = today or _today()
    if not stage.planned_end or stage.status == StageStatus.done:
        return 0
    if stage.planned_end >= today:
        return 0
    return (today - stage.planned_end).days


async def build_schedule_summary(db: AsyncSession, project: Project) -> dict:
    """Сводка сроков для Dashboard и OS KPI."""
    stages = sorted(project.stages or [], key=lambda s: s.sort_order)
    today = _today()

    overdue_stages = [s for s in stages if _stage_delay_days(s, today) > 0]
    max_delay = max((_stage_delay_days(s, today) for s in stages), default=0)

    active = next((s for s in stages if s.status == StageStatus.active), None)
    review = next((s for s in stages if s.status == StageStatus.review), None)
    current = review or active

    remaining = [s for s in stages if s.status not in (StageStatus.done,)]
    progress = sum(s.percent_complete for s in stages) / (len(stages) or 1)

    # Прогноз: сегодня + оставшаяся длительность по плану + накопленная задержка
    remaining_days = 0
    for s in remaining:
        if s.planned_start and s.planned_end:
            remaining_days += max(1, (s.planned_end - max(today, s.planned_start or today)).days + 1)
        elif s.planned_end:
            remaining_days += max(1, (s.planned_end - today).days)
        else:
            remaining_days += 7

    forecast_end = today + timedelta(days=remaining_days + max_delay)
    plan_end = project.planned_end_date or (stages[-1].planned_end if stages else None)
    forecast_delay = 0
    if plan_end:
        forecast_delay = max(0, (forecast_end - plan_end).days)

    # Риск задержки: просрочки + материалы + замечания (упрощённо)
    picks = (await db.execute(select(MaterialPick).where(MaterialPick.project_id == project.id))).scalars().all()
    undelivered = [
        p for p in picks
        if getattr(p.status, "value", p.status) in ("draft", "pending", "approved")
    ]

    risk_score = min(100, len(overdue_stages) * 25 + len(undelivered) * 5 + forecast_delay * 2)
    risk_level = "critical" if risk_score >= 70 else "high" if risk_score >= 40 else "medium" if risk_score >= 20 else "ok"

    items = []
    for s in stages[:20]:
        items.append({
            "id": s.id,
            "kind": "work",
            "title": s.name,
            "date": s.planned_end.isoformat() if s.planned_end else None,
            "start_plan": s.planned_start.isoformat() if s.planned_start else None,
            "status": s.status.value,
            "delay_days": _stage_delay_days(s, today),
            "stage_id": s.id,
        })

    purchases = (await db.execute(select(Purchase).where(Purchase.project_id == project.id))).scalars().all()
    for pu in purchases[:10]:
        d = pu.delivered_at or pu.ordered_at
        if d:
            items.append({
                "id": pu.id,
                "kind": "delivery",
                "title": f"Доставка · {pu.supplier_name or 'заказ'}",
                "date": d.date().isoformat() if hasattr(d, "date") else str(d)[:10],
                "status": getattr(pu.status, "value", pu.status),
            })

    return {
        "current_stage": current.name if current else None,
        "current_stage_id": current.id if current else None,
        "planned_end": plan_end.isoformat() if plan_end else None,
        "forecast_end": forecast_end.isoformat(),
        "forecast_delay_days": forecast_delay,
        "max_delay_days": max_delay,
        "overdue_count": len(overdue_stages),
        "progress_percent": round(progress, 1),
        "remaining_works": len(remaining),
        "risk_level": risk_level,
        "risk_score": risk_score,
        "items": sorted([i for i in items if i.get("date")], key=lambda x: x["date"])[:30],
    }
