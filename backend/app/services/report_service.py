"""Отчёты Renova OS: ежедневный, еженедельный, финальный."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ActivityEvent, Expense, Project, Stage, StageStatus
from app.services import budget_service as bud
from app.services import issue_service as iss
from app.services import risk_engine as risk


def _today() -> date:
    return datetime.utcnow().date()


async def daily_report(db: AsyncSession, project_id: str, *, day: date | None = None) -> dict:
    day = day or _today()
    tomorrow = day + timedelta(days=1)
    p = await risk.load_project_for_risks(db, project_id)
    if not p:
        return {}
    start = datetime.combine(day, datetime.min.time())
    end = start + timedelta(days=1)
    events = list((await db.execute(select(ActivityEvent).where(ActivityEvent.project_id == project_id, ActivityEvent.created_at >= start, ActivityEvent.created_at < end).order_by(ActivityEvent.created_at.desc()))).scalars().all())
    risks = (await risk.compute_project_risks(db, p))[:3]
    stages = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    tomorrow_works = [s.name for s in stages if s.planned_start == tomorrow or (s.status == StageStatus.active and s.planned_end == tomorrow)]
    expenses = list((await db.execute(select(Expense).where(Expense.project_id == project_id, Expense.expense_date >= start, Expense.expense_date < end, Expense.status.in_(("confirmed", "pending_receipt"))))).scalars().all())
    done_today = [e.title for e in events if e.kind in ("WorkCompleted", "AcceptancePassed", "IssueClosed")]
    return {
        "date": day.isoformat(),
        "project_name": p.name,
        "done_today": done_today[:10],
        "planned_tomorrow": tomorrow_works[:5],
        "risks": risks,
        "expenses_today": round(sum(e.amount for e in expenses), 2),
        "expense_items": [bud.expense_dict(e) for e in expenses[:10]],
        "events": [{"kind": e.kind, "title": e.title, "at": e.created_at.isoformat()} for e in events[:15]],
    }


async def weekly_report(db: AsyncSession, project_id: str) -> dict:
    since = datetime.utcnow() - timedelta(days=7)
    p = await risk.load_project_for_risks(db, project_id)
    if not p:
        return {}
    events = list((await db.execute(select(ActivityEvent).where(ActivityEvent.project_id == project_id, ActivityEvent.created_at >= since).order_by(ActivityEvent.created_at.desc()))).scalars().all())
    summary = await bud.budget_summary(db, project_id)
    risks = (await risk.compute_project_risks(db, p))[:5]
    issues = await iss.list_issues(db, project_id, status=None)
    open_issues = [i for i in issues if i.status != "closed"]
    stages = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    done = sum(1 for s in stages if s.status == StageStatus.done)
    total = len(stages) or 1
    overdue = [s.name for s in stages if s.planned_end and s.planned_end < _today() and s.status != StageStatus.done]
    return {
        "period": "7d",
        "project_name": p.name,
        "progress_percent": round(done / total * 100, 1),
        "stages_done": done,
        "stages_total": total,
        "budget": summary,
        "overdue_works": overdue[:5],
        "open_issues_count": len(open_issues),
        "critical_issues": len([i for i in open_issues if i.severity in ("critical", "high")]),
        "risks": risks,
        "highlights": [e.title for e in events[:12]],
    }


async def final_report(db: AsyncSession, project_id: str) -> dict:
    p = await risk.load_project_for_risks(db, project_id)
    if not p:
        return {}
    summary = await bud.budget_summary(db, project_id)
    risks = await risk.compute_project_risks(db, p)
    issues = await iss.list_issues(db, project_id, status=None)
    expenses = await bud.list_expenses(db, project_id, limit=500)
    stages = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    works = [{"name": s.name, "status": s.status.value, "amount": s.payment_amount} for s in stages]
    savings = round(summary["budget_planned"] - summary["budget_spent"], 2)
    over = max(0, summary["budget_spent"] - summary["budget_planned"])
    by_category = await _expenses_by_category(db, project_id)
    return {
        "project_name": p.name,
        "budget_planned": summary["budget_planned"],
        "budget_spent": summary["budget_spent"],
        "savings": savings if savings > 0 else 0,
        "overrun": over,
        "forecast_total": summary["forecast_total"],
        "works": works,
        "expenses_count": len(expenses),
        "expenses_total": round(sum(e.amount for e in expenses if e.status == "confirmed"), 2),
        "issues_total": len(issues),
        "issues_open": len([i for i in issues if i.status != "closed"]),
        "risks_remaining": len(risks),
        "risks": risks[:10],
        "expenses_by_category": by_category,
    }


EXPENSE_CATEGORY_LABELS = {
    "materials": "Материалы",
    "labor": "Работы",
    "delivery": "Доставка",
    "tools": "Инструмент",
    "other": "Прочее",
}

FINAL_REPORT_SECTIONS = frozenset({"summary", "works", "expenses", "risks", "issues"})


def parse_report_sections(raw: str | None) -> set[str]:
    if not raw:
        return set(FINAL_REPORT_SECTIONS)
    picked = {s.strip() for s in raw.split(",") if s.strip()}
    valid = picked & FINAL_REPORT_SECTIONS
    return valid or set(FINAL_REPORT_SECTIONS)


def parse_expense_categories(raw: str | None) -> set[str] | None:
    if not raw:
        return None
    picked = {s.strip() for s in raw.split(",") if s.strip()}
    return picked or None


async def _expenses_by_category(db: AsyncSession, project_id: str) -> list[dict]:
    from app.models.entities import Receipt

    receipts = list((await db.execute(select(Receipt).where(Receipt.project_id == project_id))).scalars().all())
    totals: dict[str, float] = {}
    for rec in receipts:
        cat = getattr(rec, "expense_category", "materials") or "materials"
        totals[cat] = totals.get(cat, 0.0) + float(rec.amount or 0)
    return [
        {
            "category": cat,
            "label": EXPENSE_CATEGORY_LABELS.get(cat, cat),
            "total": round(amount, 2),
        }
        for cat, amount in sorted(totals.items(), key=lambda x: -x[1])
    ]


def build_final_pdf(data: dict, sections: set[str], categories: set[str] | None = None):
    """PDF финального отчёта — только выбранные разделы и категории расходов."""
    from app.services.pdf_helper import new_pdf, pdf_line, pdf_response

    pdf = new_pdf()
    name = data.get("project_name", "")
    pdf_line(pdf, f"Финальный отчёт: {name}", size=14)

    if "summary" in sections:
        pdf_line(pdf, "Сводка бюджета", size=12)
        pdf_line(pdf, f"План: {data.get('budget_planned', 0):.0f} ₽", size=11)
        pdf_line(pdf, f"Факт: {data.get('budget_spent', 0):.0f} ₽", size=11)
        if data.get("overrun"):
            pdf_line(pdf, f"Перерасход: {data['overrun']:.0f} ₽", size=11)
        elif data.get("savings"):
            pdf_line(pdf, f"Экономия: {data['savings']:.0f} ₽", size=11)
        pdf_line(pdf, f"Прогноз: {data.get('forecast_total', 0):.0f} ₽", size=11)

    if "works" in sections:
        works = data.get("works", [])
        pdf_line(pdf, f"Работы ({len(works)})", size=12)
        for w in works[:25]:
            pdf_line(pdf, f"  • {w.get('name', '')} — {w.get('status', '')}", size=9)

    if "expenses" in sections:
        items = data.get("expenses_by_category", [])
        if categories:
            items = [i for i in items if i.get("category") in categories]
        pdf_line(pdf, "Расходы по статьям", size=12)
        if not items:
            pdf_line(pdf, "  Нет данных по выбранным статьям", size=9)
        for row in items:
            pdf_line(pdf, f"  • {row.get('label', row.get('category'))}: {row.get('total', 0):.0f} ₽", size=10)
        pdf_line(pdf, f"Всего операций: {data.get('expenses_count', 0)}", size=10)

    if "risks" in sections:
        risks = data.get("risks", [])
        pdf_line(pdf, f"Риски ({len(risks)})", size=12)
        for r in risks[:8]:
            title = r.get("title") if isinstance(r, dict) else str(r)
            pdf_line(pdf, f"  • {title}", size=9)

    if "issues" in sections:
        pdf_line(pdf, "Замечания", size=12)
        pdf_line(pdf, f"  Всего: {data.get('issues_total', 0)} · Открытых: {data.get('issues_open', 0)}", size=10)

    return pdf
