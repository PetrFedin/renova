"""Календарь исполнения."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project, require_project_dep
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import calendar_import_service as cal_import_svc
from app.services import calendar_service as cal_svc
from app.services import stage_mutation_service as stage_mutations
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["calendar"])


class StageDatesUpdate(BaseModel):
    stage_id: str
    planned_start: date | None = None
    planned_end: date | None = None


def _calendar_date_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code == "stage_schedule_actor_forbidden":
        return HTTPException(403, detail={"code": code})
    if code in {"confirmed_schedule_controls_dates", "stage_dates_locked_done"}:
        return HTTPException(409, detail={"code": code})
    return HTTPException(422, detail={"code": code})


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
    # STG-008: same rules as the canonical PATCH /stages/{id}/dates — schedule
    # actor, confirmed-schedule lock, project bounds, no dates on done stages.
    try:
        result = await stage_mutations.update_dates(
            db,
            project_id=project_id,
            stage_id=body.stage_id,
            actor=user,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
        )
    except ValueError as error:
        raise _calendar_date_error(error) from error
    if result is None:
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
    client_request_id: str | None = None

@router.post("/{project_id}/calendar/import")
async def import_ical(project_id: str, body: IcalImportIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Import stage dates from an .ics file — atomic and response-loss safe (#422).

    The whole file is applied in one transaction (or none of it, on any
    failure), and DTEND is parsed alongside DTSTART so multi-day stages keep
    their real end date. A retried request with byte-identical content (or
    an explicit client_request_id) replays the original result instead of
    re-mapping events onto a different set of stages; the same id with
    different content is rejected as a conflict.
    """
    await require_project(db, project_id, user, write=True)
    try:
        result = await cal_import_svc.import_ical_atomic(
            db,
            project_id=project_id,
            actor_id=user.id,
            content=body.content,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict:
        raise HTTPException(409, "calendar_import_conflict")
    except ValueError as error:
        raise _calendar_date_error(error) from error
    return result
