"""Canonical non-stage calendar item mutations."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.calendar_integrity import _item_dict
from app.db.session import get_db
from app.models.entities import User
from app.services import calendar_mutation_service as calendar_mutations

router = APIRouter(prefix="/calendar", tags=["calendar"])


class CalendarItemCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    event_type: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=16)
    is_public: bool = False
    recurrence: str | None = Field(default=None, max_length=128)
    location: str | None = Field(default=None, max_length=500)
    reminder_at: datetime | None = None
    project_id: str | None = None
    stage_id: str | None = None


class CalendarItemPatchIn(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    event_type: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=16)
    is_public: bool | None = None
    recurrence: str | None = Field(default=None, max_length=128)
    location: str | None = Field(default=None, max_length=500)
    reminder_at: datetime | None = None
    project_id: str | None = None
    stage_id: str | None = None


def _mutation_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {"calendar_item_owner_only", "calendar_project_write_forbidden"}:
        return HTTPException(403, detail={"code": code})
    if code in {"calendar_project_not_found", "calendar_stage_not_found"}:
        return HTTPException(404, detail={"code": code})
    if code == "calendar_stage_projection_managed":
        return HTTPException(409, detail={"code": code})
    return HTTPException(422, detail={"code": code})


@router.post("")
async def create_calendar_item(
    body: CalendarItemCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await calendar_mutations.create_item(
            db,
            actor=user,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            all_day=body.all_day,
            event_type=body.event_type,
            color=body.color,
            is_public=body.is_public,
            recurrence=body.recurrence,
            location=body.location,
            reminder_at=body.reminder_at,
            project_id=body.project_id,
            stage_id=body.stage_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    response = _item_dict(result.item)
    response["replayed"] = result.replayed
    return response


@router.patch("/{item_id}")
@router.put("/{item_id}")
async def update_calendar_item(
    item_id: str,
    body: CalendarItemPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    changes = body.model_dump(exclude_unset=True)
    try:
        result = await calendar_mutations.update_item(
            db,
            actor=user,
            item_id=item_id,
            changes=changes,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "calendar_item_not_found"})
    response = _item_dict(result.item)
    response["replayed"] = result.replayed
    return response


@router.delete("/{item_id}")
async def delete_calendar_item(
    item_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        deleted = await calendar_mutations.delete_item(
            db,
            actor=user,
            item_id=item_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if deleted is None:
        raise HTTPException(404, detail={"code": "calendar_item_not_found"})
    return {"ok": True, "id": item_id}
