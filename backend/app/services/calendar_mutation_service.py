"""Role-scoped, atomic mutations for non-stage calendar items."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import CalendarItem, Project, Stage, User

_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


@dataclass(frozen=True)
class CalendarMutationResult:
    item: CalendarItem
    replayed: bool


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _clean_text(value: str | None, *, limit: int, required: bool = False) -> str | None:
    normalized = (value or "").strip()
    if required and not normalized:
        raise ValueError("calendar_title_required")
    if len(normalized) > limit:
        raise ValueError("calendar_text_too_long")
    return normalized or None


def _validate_timing(
    *,
    start_at: datetime,
    end_at: datetime,
    reminder_at: datetime | None,
) -> None:
    if _utc(end_at) <= _utc(start_at):
        raise ValueError("calendar_interval_invalid")
    if reminder_at is not None and _utc(reminder_at) > _utc(start_at):
        raise ValueError("calendar_reminder_after_start")


def _validate_color(color: str | None) -> str | None:
    normalized = (color or "").strip() or None
    if normalized is not None and not _HEX_COLOR.fullmatch(normalized):
        raise ValueError("calendar_color_invalid")
    return normalized


def _is_canonical_stage_projection(item: CalendarItem) -> bool:
    return item.stage_id is not None and item.event_type == "stage"


async def _locked_item(db: AsyncSession, item_id: str) -> CalendarItem | None:
    query = select(CalendarItem).where(CalendarItem.id == item_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _locked_project(db: AsyncSession, project_id: str) -> Project | None:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _validate_link(
    db: AsyncSession,
    *,
    actor: User,
    project_id: str | None,
    stage_id: str | None,
) -> tuple[str | None, str | None]:
    from app.services import team_service

    resolved_project_id = project_id
    stage: Stage | None = None
    if stage_id is not None:
        stage = await db.get(Stage, stage_id)
        if stage is None:
            raise ValueError("calendar_stage_not_found")
        if resolved_project_id is None:
            resolved_project_id = stage.project_id
        elif stage.project_id != resolved_project_id:
            raise ValueError("calendar_stage_project_mismatch")

    if resolved_project_id is None:
        return None, stage_id
    project = await _locked_project(db, resolved_project_id)
    if project is None:
        raise ValueError("calendar_project_not_found")
    if not await team_service.can_access_project(db, actor, project, write=True):
        raise ValueError("calendar_project_write_forbidden")
    return project.id, stage_id


async def create_item(
    db: AsyncSession,
    *,
    actor: User,
    title: str,
    start_at: datetime,
    end_at: datetime,
    description: str | None = None,
    all_day: bool = False,
    event_type: str | None = None,
    color: str | None = None,
    is_public: bool = False,
    recurrence: str | None = None,
    location: str | None = None,
    reminder_at: datetime | None = None,
    project_id: str | None = None,
    stage_id: str | None = None,
) -> CalendarMutationResult:
    clean_title = _clean_text(title, limit=255, required=True)
    clean_description = _clean_text(description, limit=4000)
    clean_location = _clean_text(location, limit=500)
    clean_recurrence = _clean_text(recurrence, limit=128)
    clean_event_type = _clean_text(event_type, limit=64) or "other"
    clean_color = _validate_color(color)
    _validate_timing(start_at=start_at, end_at=end_at, reminder_at=reminder_at)
    if clean_event_type == "stage":
        raise ValueError("calendar_stage_projection_managed")

    try:
        resolved_project_id, resolved_stage_id = await _validate_link(
            db,
            actor=actor,
            project_id=project_id,
            stage_id=stage_id,
        )
        item = CalendarItem(
            user_id=actor.id,
            title=clean_title,
            description=clean_description,
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
            event_type=clean_event_type,
            color=clean_color,
            is_public=is_public,
            recurrence=clean_recurrence,
            location=clean_location,
            reminder_at=reminder_at,
            reminder_sent=False,
            project_id=resolved_project_id,
            stage_id=resolved_stage_id,
        )
        db.add(item)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(item)
    return CalendarMutationResult(item=item, replayed=False)


async def update_item(
    db: AsyncSession,
    *,
    actor: User,
    item_id: str,
    changes: dict,
) -> CalendarMutationResult | None:
    item = await _locked_item(db, item_id)
    if item is None:
        await db.rollback()
        return None
    if item.user_id != actor.id:
        await db.rollback()
        raise ValueError("calendar_item_owner_only")
    if _is_canonical_stage_projection(item):
        await db.rollback()
        raise ValueError("calendar_stage_projection_managed")

    try:
        next_project_id = changes.get("project_id", item.project_id)
        next_stage_id = changes.get("stage_id", item.stage_id)
        if "project_id" in changes and changes["project_id"] is None and "stage_id" not in changes:
            next_stage_id = None
        resolved_project_id, resolved_stage_id = await _validate_link(
            db,
            actor=actor,
            project_id=next_project_id,
            stage_id=next_stage_id,
        )

        next_title = (
            _clean_text(changes["title"], limit=255, required=True)
            if "title" in changes
            else item.title
        )
        next_description = (
            _clean_text(changes["description"], limit=4000)
            if "description" in changes
            else item.description
        )
        next_location = (
            _clean_text(changes["location"], limit=500)
            if "location" in changes
            else item.location
        )
        next_recurrence = (
            _clean_text(changes["recurrence"], limit=128)
            if "recurrence" in changes
            else item.recurrence
        )
        next_event_type = (
            _clean_text(changes["event_type"], limit=64) or "other"
            if "event_type" in changes
            else item.event_type
        )
        if next_event_type == "stage":
            raise ValueError("calendar_stage_projection_managed")
        next_color = (
            _validate_color(changes["color"])
            if "color" in changes
            else item.color
        )
        next_start = changes.get("start_at", item.start_at)
        next_end = changes.get("end_at", item.end_at)
        next_reminder = changes.get("reminder_at", item.reminder_at)
        _validate_timing(
            start_at=next_start,
            end_at=next_end,
            reminder_at=next_reminder,
        )

        desired = {
            "title": next_title,
            "description": next_description,
            "start_at": next_start,
            "end_at": next_end,
            "all_day": changes.get("all_day", item.all_day),
            "event_type": next_event_type,
            "color": next_color,
            "is_public": changes.get("is_public", item.is_public),
            "recurrence": next_recurrence,
            "location": next_location,
            "reminder_at": next_reminder,
            "project_id": resolved_project_id,
            "stage_id": resolved_stage_id,
        }
        changed = False
        for field, value in desired.items():
            current = getattr(item, field)
            equal = _utc(current) == _utc(value) if isinstance(current, datetime) and isinstance(value, datetime) else current == value
            if not equal:
                setattr(item, field, value)
                changed = True
        if not changed:
            await db.commit()
            return CalendarMutationResult(item=item, replayed=True)
        if "reminder_at" in changes or "start_at" in changes:
            item.reminder_sent = False
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(item)
    return CalendarMutationResult(item=item, replayed=False)


async def delete_item(
    db: AsyncSession,
    *,
    actor: User,
    item_id: str,
) -> bool | None:
    item = await _locked_item(db, item_id)
    if item is None:
        await db.rollback()
        return None
    if item.user_id != actor.id:
        await db.rollback()
        raise ValueError("calendar_item_owner_only")
    if _is_canonical_stage_projection(item):
        await db.rollback()
        raise ValueError("calendar_stage_projection_managed")
    try:
        if item.project_id is not None:
            await _validate_link(
                db,
                actor=actor,
                project_id=item.project_id,
                stage_id=item.stage_id,
            )
        await db.delete(item)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return True
