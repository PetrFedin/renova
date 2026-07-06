"""Календарь исполнения."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project, require_project_dep
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import calendar_service as cal_svc
from app.services import stage_service as stage_svc

router = APIRouter(prefix="/projects", tags=["calendar"])


class StageDatesUpdate(BaseModel):
    stage_id: str
    planned_start: date | None = None
    planned_end: date | None = None


@router.get("/{project_id}/calendar")
async def get_calendar(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import WasteOrder
    p = await require_project(db, project_id, user, write=False)
    waste = (await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id))).scalars().all()
    return cal_svc.build_calendar(p, waste)


@router.patch("/{project_id}/calendar/stages")
async def update_stage_dates(
    project_id: str,
    body: StageDatesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель меняет даты")
    stage = await stage_svc.update_stage_dates(db, body.stage_id, body.planned_start, body.planned_end)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    from sqlalchemy import select
    from app.models.entities import WasteOrder
    p = await require_project(db, project_id, user, write=False)
    waste = (await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id))).scalars().all()
    return cal_svc.build_calendar(p, waste)

@router.get("/{project_id}/calendar.ics")
async def export_ical(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    from fastapi.responses import Response
    p = await require_project(db, project_id, user, write=False)
    data = cal_svc.build_calendar(p)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Renova//EN"]
    for e in data.get("events", []):
        uid = e.get("uid") or e.get("stage_id") or ""
        dtstart = e.get("date", "").replace("-", "")
        lines += ["BEGIN:VEVENT", f"UID:renova-{uid}@app", f"SUMMARY:{e.get('title','')}", f"DTSTART;VALUE=DATE:{dtstart}"]
        end_date = e.get("end_date")
        if end_date:
            # iCal all-day DTEND is exclusive
            from datetime import datetime, timedelta
            end_excl = (datetime.strptime(end_date, "%Y-%m-%d").date() + timedelta(days=1)).strftime("%Y%m%d")
            lines.append(f"DTEND;VALUE=DATE:{end_excl}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines), media_type="text/calendar", headers={"Content-Disposition": f"attachment; filename=renova-{project_id[:8]}.ics"})


class IcalImportIn(BaseModel):
    content: str

@router.post("/{project_id}/calendar/import")
async def import_ical(project_id: str, body: IcalImportIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    import re
    from datetime import datetime as dt
    events = []
    summary = None
    current_uid = None
    for line in body.content.replace("\r", "").split("\n"):
        line = line.strip()
        if line.startswith("UID:"):
            current_uid = line[4:].strip()
        elif line.startswith("SUMMARY:"):
            summary = line[8:]
        elif line.startswith("DTSTART"):
            raw = line.split(":", 1)[-1][:8]
            if len(raw) == 8:
                events.append({"title": summary or "Event", "date": f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}", "uid": current_uid})
            current_uid = None
            summary = None
    updated = 0
    p = await require_project(db, project_id, user, write=False)
    stages = sorted(p.stages, key=lambda s: s.sort_order)
    for ev in events:
        d = dt.strptime(ev["date"], "%Y-%m-%d").date()
        uid = ev.get('uid') or ''
        stage = None
        if uid:
            for st in stages:
                if st.ical_uid == uid or uid.endswith(st.id):
                    stage = st; break
        if not stage and ev.get('title'):
            stage = next((st for st in stages if st.name.lower() in ev['title'].lower() or ev['title'].lower() in st.name.lower()), None)
        if not stage:
            unused = [st for st in stages if not st.planned_start]
            stage = unused[0] if unused else None
        if stage:
            await stage_svc.update_stage_dates(db, stage.id, d, d)
            if uid:
                stage.ical_uid = uid
            updated += 1
    await db.commit()
    return {"ok": True, "parsed": len(events), "updated_stages": updated}
