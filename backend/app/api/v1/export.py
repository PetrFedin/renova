"""PDF и экспорт проекта — fpdf2 с транслитерацией кириллицы."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import project_service as proj_svc
from app.services.pdf_helper import new_pdf, pdf_line, pdf_response

router = APIRouter(prefix="/projects", tags=["export"])


@router.get("/{project_id}/estimate.pdf")
async def export_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    pdf = new_pdf()
    pdf_line(pdf, f"Смета: {p.name}", size=14)
    for line in p.estimate_lines:
        total = line.quantity_planned * line.unit_price
        pdf_line(pdf, f"{line.name} | {line.quantity_planned} {line.unit} x {line.unit_price} = {total:.0f} RUB")
    pdf_line(pdf, f"ИТОГО: {p.budget_planned:.0f} ₽", size=11)
    return pdf_response(pdf, f"estimate-{project_id[:8]}.pdf")


@router.get("/{project_id}/stages/{stage_id}/acceptance.pdf")
async def export_acceptance(project_id: str, stage_id: str, checks: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import stage_service as st_svc

    await require_project(db, project_id, user, write=False)
    stage = await st_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    pdf = new_pdf()
    pdf_line(pdf, f"Priyomka: {stage.name}", size=14)
    pdf_line(pdf, f"Status: {stage.status.value}")
    pdf_line(pdf, f"Oplata: {stage.payment_amount:.0f} RUB")
    if stage.customer_accepted_at:
        pdf_line(pdf, f"Prinyato: {stage.customer_accepted_at.isoformat()[:10]}")
    if checks:
        pdf_line(pdf, "Checklist:", size=11)
        for item in checks.split("|"):
            pdf_line(pdf, f"[x] {item}")
    pdf_line(pdf, "Photos:", size=11)
    for photo in stage.photos[:10]:
        pdf_line(pdf, f"- {photo.caption or 'photo'} ({photo.created_at.date()})")
    return pdf_response(pdf, f"acceptance-{stage_id[:8]}.pdf")


@router.get("/{project_id}/rooms/{room_id}/export.pdf")
async def export_room_pdf(project_id: str, room_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Room
    from app.services.room_service import room_detail

    await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    d = room_detail(room)
    pdf = new_pdf()
    pdf_line(pdf, f"Komnata: {d['name']}", size=14)
    pdf_line(pdf, f"Size: {d['length_m']}x{d['width_m']} h{d['height_m']}")
    pdf_line(pdf, f"Floor: {d['floor_sq_m']} m2 | Walls: {d['wall_sq_m']} m2")
    pdf_line(pdf, f"Outlets: {d['outlets_count']} | Plumbing: {d['plumbing_points']}")
    return pdf_response(pdf, f"room-{room_id[:8]}.pdf")


@router.get("/{project_id}/export.pdf")
async def export_project_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    pdf = new_pdf()
    pdf_line(pdf, f"Проект: {p.name}", size=14)
    pdf_line(pdf, f"Бюджет: {p.budget_planned:.0f} / {p.budget_spent:.0f} ₽")
    for room in getattr(p, "rooms", None) or []:
        pdf_line(pdf, f"Комната: {room.name}")
    for st in p.stages or []:
        pdf_line(pdf, f"Etap: {st.name} [{st.status.value}]")
    return pdf_response(pdf, f"project-{project_id[:8]}.pdf")


@router.get("/{project_id}/estimate.csv")
async def export_estimate_csv(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    lines = ["name,unit,qty_plan,qty_fact,unit_price,total"]
    for line in p.estimate_lines:
        lines.append(f"{line.name},{line.unit},{line.quantity_planned},{line.quantity_actual},{line.unit_price},{line.quantity_planned * line.unit_price}")
    body = "\n".join(lines)
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=estimate-{project_id[:8]}.csv"})


@router.get("/{project_id}/estimate.xlsx")
async def export_xlsx(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from itertools import groupby

    p = await require_project(db, project_id, user, write=False)
    total = sum(line.quantity_planned * line.unit_price for line in p.estimate_lines)
    sorted_lines = sorted(p.estimate_lines, key=lambda x: x.room_name or "Obschee")
    rows = ""
    for room, grp in groupby(sorted_lines, key=lambda x: x.room_name or "Obschee"):
        rows += f"<Row><Cell><Data>[{room}]</Data></Cell></Row>"
        for line in grp:
            rows += f"<Row><Cell><Data>{line.name}</Data></Cell><Cell><Data>{line.quantity_planned}</Data></Cell><Cell><Data>{line.unit_price}</Data></Cell><Cell><Data>{line.quantity_planned * line.unit_price * 0.2:.0f}</Data></Cell></Row>"
    xml = (
        '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>'
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">'
        f'<Worksheet ss:Name="Estimate" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Table>{rows}'
        f"<Row><Cell><Data>TOTAL</Data></Cell><Cell/><Cell/><Cell><Data>{total * 0.2:.0f}</Data></Cell>"
        f"<Cell><Data>{total * 1.2:.0f}</Data></Cell></Row></Table></Worksheet></Workbook>"
    )
    return Response(xml.encode("utf-8"), media_type="application/vnd.ms-excel", headers={"Content-Disposition": f"attachment; filename=estimate-{project_id[:8]}.xls"})


@router.get("/{project_id}/rooms/{room_id}/audit.pdf")
async def export_room_audit(project_id: str, room_id: str, field: str | None = None, since: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import datetime as dt
    from sqlalchemy import select
    from app.models.entities import Room, RoomChangeLog

    await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    q = select(RoomChangeLog).where(RoomChangeLog.room_id == room_id)
    if field:
        q = q.where(RoomChangeLog.field_name == field)
    if since:
        q = q.where(RoomChangeLog.created_at >= dt.fromisoformat(since))
    logs = (await db.execute(q.order_by(RoomChangeLog.created_at))).scalars().all()
    pdf = new_pdf()
    pdf_line(pdf, f"Audit: {room.name}", size=14)
    for lg in logs:
        pdf_line(pdf, f"{lg.created_at.date()} {lg.field_name}: {lg.old_value} -> {lg.new_value}")
    return pdf_response(pdf, f"audit-{room_id[:8]}.pdf")


@router.get("/{project_id}/kpi-weekly.pdf")
async def export_kpi_weekly(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.models.entities import MarginSnapshot

    p = await require_project(db, project_id, user, write=False)
    since = datetime.utcnow() - timedelta(days=7)
    r = await db.execute(select(MarginSnapshot).where(MarginSnapshot.project_id == project_id, MarginSnapshot.recorded_at >= since))
    snaps = list(r.scalars().all())
    pdf = new_pdf()
    pdf_line(pdf, f"KPI week: {p.name}", size=14)
    pdf_line(pdf, f"Marzha: {p.budget_planned - p.budget_spent:.0f}")
    vals = [s.margin_estimated for s in snaps] or [0]
    mx = max(vals) or 1
    pdf_line(pdf, "Sparkline:", size=11)
    bar = "".join(chr(9608) * max(1, int(v / mx * 8)) if v else "." for v in vals)
    pdf_line(pdf, f"BAR {bar}", size=9)
    for s in snaps:
        pdf_line(pdf, f"{s.recorded_at.date()}: {s.margin_estimated:.0f}")
    return pdf_response(pdf, f"kpi-{project_id[:8]}.pdf")


@router.get("/{project_id}/activity-dossier.pdf")
async def export_dossier(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import activity_service as act

    p = await require_project(db, project_id, user, write=False)
    items = await act.project_feed(db, project_id, limit=100)
    pdf = new_pdf()
    pdf_line(pdf, f"Dossier: {p.name}", size=14)
    for it in items:
        pdf_line(pdf, f"{it.get('at', '')[:10]} | {it.get('kind')} | {it.get('title')}", size=9)
    return pdf_response(pdf, f"dossier-{project_id[:8]}.pdf")


@router.get("/{project_id}/full-dossier.pdf")
async def full_dossier(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import activity_service as act

    p = await require_project(db, project_id, user, write=False)
    items = await act.project_feed(db, project_id, limit=50)
    pdf = new_pdf()
    pdf_line(pdf, f"Full dossier: {p.name}", size=14)
    pdf_line(pdf, f"Byudzhet: {p.budget_planned:.0f} / spent {p.budget_spent:.0f}")
    for line in p.estimate_lines[:30]:
        pdf_line(pdf, f"- {line.name}: {line.quantity_planned * line.unit_price:.0f}")
    pdf_line(pdf, "Activity:", size=11)
    for it in items[:40]:
        pdf_line(pdf, f"{it.get('at', '')[:10]} {it.get('title', '')}", size=8)
    return pdf_response(pdf, f"full-{project_id[:8]}.pdf")
