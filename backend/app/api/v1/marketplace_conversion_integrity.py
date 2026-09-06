"""Replay-safe marketplace lead conversion into a lead-synchronized project."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.marketplace import ConvertLeadIn
from app.db.session import get_db
from app.models.entities import JobLead, JobLeadStatus, User, UserRole
from app.services import project_create_service as creation
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(tags=["marketplace"])


@router.post("/job-leads/{lead_id}/convert")
async def convert_lead(
    lead_id: str,
    body: ConvertLeadIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(JobLead, lead_id)
    if not lead:
        raise HTTPException(404, "lead_not_found")
    if lead.status != JobLeadStatus.quoted:
        raise HTTPException(409, "lead_not_ready_for_conversion")

    if user.role == UserRole.customer:
        if lead.customer_id != user.id:
            raise HTTPException(403, "lead_owner_only")
        contractor_id = lead.assigned_contractor_id
    elif user.role == UserRole.contractor:
        if lead.assigned_contractor_id != user.id:
            raise HTTPException(403, "assigned_contractor_only")
        contractor_id = user.id
    else:
        raise HTTPException(403, "lead_conversion_role_forbidden")

    if not contractor_id:
        raise HTTPException(409, "lead_has_no_contractor")

    if body and body.rooms:
        rooms = [room if isinstance(room, dict) else room.model_dump() for room in body.rooms]
    else:
        rooms = [
            {
                "name": "Комната",
                "length_m": 4,
                "width_m": 3,
                "height_m": 2.7,
                "room_type": "living",
                "floor_level": 1,
            }
        ]
    property_type = body.property_type if body else "apartment"
    try:
        result = await creation.create_project(
            db,
            customer_id=lead.customer_id,
            name=lead.title,
            address=lead.address,
            renovation_type=lead.renovation_type,
            rooms_data=rooms,
            contractor_id=contractor_id,
            total_area_sqm=lead.area_sqm,
            property_type=property_type,
            client_request_id=f"marketplace-lead:{lead_id}",
            scope=creation.PROJECT_MARKETPLACE_CREATE_SCOPE,
            participant_actor_id=user.id,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={"code": "lead_conversion_idempotency_conflict"},
        ) from error
    except ValueError as error:
        code = str(error)
        status = 404 if code == "participant_contractor_invalid" else 422
        raise HTTPException(status, detail={"code": code}) from error

    lead.status = JobLeadStatus.taken
    await db.commit()
    return {"project_id": result.project.id, "name": result.project.name}
