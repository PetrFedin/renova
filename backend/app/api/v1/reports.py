"""Renova OS — отчёты daily / weekly / final + PDF."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import report_service as rep
from app.services.pdf_helper import new_pdf, pdf_line, pdf_response

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


@router.get("/daily")
async def report_daily(project_id: str, day: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    d = date.fromisoformat(day) if day else None
    return await rep.daily_report(db, project_id, day=d)


@router.get("/weekly")
async def report_weekly(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    return await rep.weekly_report(db, project_id)


@router.get("/final")
async def report_final(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    return await rep.final_report(db, project_id)


@router.get("/daily.pdf")
async def report_daily_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    data = await rep.daily_report(db, project_id)
    if not data:
        raise HTTPException(404)
    pdf = new_pdf()
    pdf_line(pdf, f"Ежедневный отчёт: {data.get('project_name', '')}", size=14)
    pdf_line(pdf, f"Дата: {data.get('date', '')}", size=11)
    pdf_line(pdf, f"Расходы: {data.get('expenses_today', 0):.0f} ₽", size=11)
    pdf_line(pdf, "Сделано:", size=11)
    for t in data.get("done_today", [])[:8]:
        pdf_line(pdf, f"  • {t}", size=9)
    pdf_line(pdf, "Завтра:", size=11)
    for t in data.get("planned_tomorrow", [])[:5]:
        pdf_line(pdf, f"  • {t}", size=9)
    return pdf_response(pdf, f"daily-{project_id[:8]}.pdf")


@router.get("/weekly.pdf")
async def report_weekly_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    data = await rep.weekly_report(db, project_id)
    if not data:
        raise HTTPException(404)
    pdf = new_pdf()
    pdf_line(pdf, f"Недельный отчёт: {data.get('project_name', '')}", size=14)
    pdf_line(pdf, f"Прогресс: {data.get('progress_percent', 0)}%", size=11)
    b = data.get("budget", {})
    pdf_line(pdf, f"План: {b.get('budget_planned', 0):.0f} · Факт: {b.get('budget_spent', 0):.0f}", size=11)
    pdf_line(pdf, f"Открытых замечаний: {data.get('open_issues_count', 0)}", size=11)
    return pdf_response(pdf, f"weekly-{project_id[:8]}.pdf")


@router.get("/final.pdf")
async def report_final_pdf(
    project_id: str,
    sections: str | None = Query(None, description="summary,works,expenses,risks,issues"),
    categories: str | None = Query(None, description="materials,labor,delivery,tools,other"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    data = await rep.final_report(db, project_id)
    if not data:
        raise HTTPException(404)
    picked_sections = rep.parse_report_sections(sections)
    picked_categories = rep.parse_expense_categories(categories)
    pdf = rep.build_final_pdf(data, picked_sections, picked_categories)
    suffix = project_id[:8]
    if sections or categories:
        suffix = f"{suffix}-partial"
    return pdf_response(pdf, f"final-{suffix}.pdf")
