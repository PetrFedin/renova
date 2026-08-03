"""Canonical calendar reads, ICS feed and stage synchronization."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.models.entities import CalendarItem, User
from app.services import calendar_integrity_service as calendar_svc

router = APIRouter(prefix="/calendar", tags=["calendar"])


def _item_dict(item: CalendarItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "start_at": item.start_at,
        "end_at": item.end_at,
        "all_day": item.all_day,
        "event_type": item.event_type,
        "color": item.color,
        "is_public": item.is_public,
        "recurrence": item.recurrence,
        "location": item.location,
        "reminder_at": item.reminder_at,
        "reminder_sent": item.reminder_sent,
        "project_id": item.project_id,
        "stage_id": item.stage_id,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _resolved_range(
    *,
    start_at: datetime | None,
    end_at: datetime | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_alias: datetime | None,
    to_alias: datetime | None,
) -> tuple[datetime | None, datetime | None]:
    return (
        start_at or date_from or from_alias,
        end_at or date_to or to_alias,
    )


@router.get("")
async def list_calendar(
    project_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    from_alias: datetime | None = Query(default=None, alias="from"),
    to_alias: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if project_id is not None:
        await require_project(db, project_id, user, write=False)
    range_start, range_end = _resolved_range(
        start_at=start_at,
        end_at=end_at,
        date_from=date_from,
        date_to=date_to,
        from_alias=from_alias,
        to_alias=to_alias,
    )
    if range_start and range_end and range_end < range_start:
        raise HTTPException(422, detail={"code": "calendar_range_invalid"})
    items = await calendar_svc.visible_items(
        db,
        user=user,
        project_id=project_id,
        start_at=range_start,
        end_at=range_end,
        limit=limit,
    )
    return [_item_dict(item) for item in items]


@router.get("/upcoming")
async def upcoming_calendar(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    start_at = utc_now()
    end_at = start_at + timedelta(days=days)
    items = await calendar_svc.visible_items(
        db,
        user=user,
        start_at=start_at,
        end_at=end_at,
        limit=limit,
    )
    return [_item_dict(item) for item in items]


def _ics_escape(value: str | None) -> str:
    return (
        (value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ics_event(item: CalendarItem) -> list[str]:
    lines = [
        "BEGIN:VEVENT",
        f"UID:renova-calendar-{item.id}@renova",
        f"DTSTAMP:{_ics_datetime(item.updated_at or item.created_at or utc_now())}",
        f"DTSTART:{_ics_datetime(item.start_at)}",
        f"DTEND:{_ics_datetime(item.end_at)}",
        f"SUMMARY:{_ics_escape(item.title)}",
    ]
    if item.description:
        lines.append(f"DESCRIPTION:{_ics_escape(item.description)}")
    if item.location:
        lines.append(f"LOCATION:{_ics_escape(item.location)}")
    lines.extend(["END:VEVENT"])
    return lines


@router.get("/ics", response_class=PlainTextResponse)
async def calendar_ics(
    token: str = Query(min_length=16, max_length=256),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.ics_token == token))
    if user is None:
        raise HTTPException(404, detail={"code": "calendar_token_invalid"})
    items = await calendar_svc.visible_items(db, user=user)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Renova//Calendar//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for item in items:
        lines.extend(_ics_event(item))
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines) + "\r\n", media_type="text/calendar")


@router.post("/sync-stages/{project_id}")
async def sync_project_stages(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    result = await calendar_svc.sync_project_stages(
        db,
        project_id=project_id,
        actor=user,
    )
    if result is None:
        raise HTTPException(404, detail={"code": "project_not_found"})
    return {
        "created": result.created,
        "updated": result.updated,
        "deleted": result.deleted,
        "synced": result.created + result.updated,
    }
