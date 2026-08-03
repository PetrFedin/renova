"""Grant-scoped calendar item detail reads."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.calendar_integrity import _item_dict
from app.db.session import get_db
from app.models.entities import CalendarItem, User
from app.services import calendar_integrity_service as calendar_svc

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/{item_id}")
@router.get("/items/{item_id}", include_in_schema=False)
@router.get("/events/{item_id}", include_in_schema=False)
async def get_calendar_item(
    item_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.scalar(
        calendar_svc.visible_items_query(user).where(CalendarItem.id == item_id)
    )
    if item is None:
        # Do not reveal whether an inaccessible item exists.
        raise HTTPException(404, detail={"code": "calendar_item_not_found"})
    return _item_dict(item)
