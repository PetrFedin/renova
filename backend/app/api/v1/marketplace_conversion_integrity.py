"""Validated marketplace conversion API; the service owns its one transaction."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project import RoomInput
from app.services import marketplace_conversion_service as conversion
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(tags=["marketplace"])


class ConversionRoomIn(RoomInput):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)


class ConvertLeadIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    property_type: str = Field(default="apartment", min_length=1, max_length=32)
    rooms: list[ConversionRoomIn] | None = Field(default=None, min_length=1, max_length=100)


def _conversion_error(error: ValueError) -> HTTPException:
    code = str(error)
    if isinstance(error, IdempotencyConflict):
        return HTTPException(409, detail={"code": "lead_conversion_idempotency_conflict"})
    if code in {"lead_not_found", "participant_contractor_invalid"}:
        status = 404
    elif code in {"lead_owner_only", "assigned_contractor_only", "lead_conversion_role_forbidden"}:
        status = 403
    elif code in {
        "lead_not_ready_for_conversion", "lead_has_no_contractor",
        "lead_conversion_record_missing", "lead_conversion_state_inconsistent",
        "lead_conversion_project_unavailable", "lead_conversion_project_scope_mismatch",
    }:
        status = 409
    else:
        status = 422
    return HTTPException(status, detail={"code": code})


@router.post("/job-leads/{lead_id}/convert")
async def convert_lead(
    lead_id: str,
    body: ConvertLeadIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body = body or ConvertLeadIn()
    rooms = body.rooms or [ConversionRoomIn(
        name="Комната", length_m=4, width_m=3, height_m=2.7,
        room_type="living", floor_level=1,
    )]
    try:
        result = await conversion.convert_lead(
            db, lead_id=lead_id, actor_id=user.id,
            rooms_data=[room.model_dump() for room in rooms], property_type=body.property_type,
        )
    except ValueError as error:
        raise _conversion_error(error) from error
    return {"project_id": result.project.id, "name": result.project.name}
