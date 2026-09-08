"""One transaction for a marketplace conversion and its stable replay mapping."""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import JobLead, JobLeadStatus, Project, User, UserRole
from app.services import project_create_service as creation
from app.services.client_write_idempotency import commit_client_write, replay_entity_id


async def _conversion_project(
    db: AsyncSession, *, project_id: str, customer_id: str, contractor_id: str,
) -> Project:
    project = await db.get(Project, project_id, populate_existing=True)
    if project is None or project.trashed_at is not None:
        raise ValueError("lead_conversion_project_unavailable")
    if project.customer_id != customer_id or project.contractor_id != contractor_id:
        raise ValueError("lead_conversion_project_scope_mismatch")
    return await creation._loaded_project(db, project_id)


async def convert_lead(
    db: AsyncSession,
    *,
    lead_id: str,
    actor_id: str,
    rooms_data: list[dict],
    property_type: str,
) -> creation.ProjectCreateResult:
    """Authorize before replay; never persist a project without taking its lead.

    The replay fingerprint represents explicit conversion input, not date.today()
    or mutable lead display fields. A retry after midnight or a lost response
    returns the original project and never manufactures a new schedule.
    """
    try:
        lead = await db.scalar(
            select(JobLead).where(JobLead.id == lead_id)
            .with_for_update().execution_options(populate_existing=True)
        )
        if lead is None:
            raise ValueError("lead_not_found")
        actor = await db.get(User, actor_id, populate_existing=True)
        if actor is None or actor.deleted_at is not None:
            raise ValueError("lead_conversion_role_forbidden")
        if actor.role == UserRole.customer:
            if actor.id != lead.customer_id:
                raise ValueError("lead_owner_only")
        elif actor.role == UserRole.contractor:
            if actor.id != lead.assigned_contractor_id:
                raise ValueError("assigned_contractor_only")
        else:
            raise ValueError("lead_conversion_role_forbidden")

        if lead.status not in {JobLeadStatus.quoted, JobLeadStatus.taken}:
            raise ValueError("lead_not_ready_for_conversion")
        customer_id, contractor_id = lead.customer_id, lead.assigned_contractor_id
        if not contractor_id:
            raise ValueError("lead_has_no_contractor")
        clean_property = property_type.strip()
        if not clean_property or len(clean_property) > 32:
            raise ValueError("project_type_invalid")
        if not isinstance(rooms_data, list) or not rooms_data or any(
            not isinstance(room, dict) for room in rooms_data
        ):
            raise ValueError("project_rooms_required")
        normalized_rooms = creation._normalized_rooms(rooms_data)
        for room in normalized_rooms:
            for value in room.values():
                if isinstance(value, float) and not math.isfinite(value):
                    raise ValueError("project_room_number_invalid")
        request_payload = {
            "version": 1,
            "lead_id": lead_id,
            "property_type": clean_property,
            "rooms": normalized_rooms,
        }
        request_id = f"marketplace-lead:{lead_id}"
        replay_id = await replay_entity_id(
            db, scope=creation.PROJECT_MARKETPLACE_CREATE_SCOPE,
            project_id=customer_id, user_id=customer_id,
            request_id=request_id, payload=request_payload,
        )
        if replay_id:
            # A quoted lead with a committed mapping is legacy partial truth.
            # Do not silently bless it as a newly atomic conversion.
            if lead.status != JobLeadStatus.taken:
                raise ValueError("lead_conversion_state_inconsistent")
            project = await _conversion_project(
                db, project_id=replay_id, customer_id=customer_id, contractor_id=contractor_id,
            )
            await db.commit()
            return creation.ProjectCreateResult(project, True)
        if lead.status == JobLeadStatus.taken:
            raise ValueError("lead_conversion_record_missing")
        if not math.isfinite(float(lead.area_sqm)) or lead.area_sqm <= 0:
            raise ValueError("project_area_invalid")

        payload = creation._project_payload(
            name=lead.title, address=lead.address, renovation_type=lead.renovation_type,
            property_type=clean_property, total_area_sqm=lead.area_sqm,
            planned_start_date=None, planned_end_date=None,
            rooms_data=normalized_rooms, contractor_id=contractor_id, template_id=None,
        )
        project = await creation.prepare_project_in_transaction(
            db, customer_id=customer_id, payload=payload, participant_actor_id=actor_id,
        )
        lead.status = JobLeadStatus.taken
        candidate_id = project.id
        created, entity_id = await commit_client_write(
            db, scope=creation.PROJECT_MARKETPLACE_CREATE_SCOPE,
            project_id=customer_id, user_id=customer_id,
            request_id=request_id, payload=request_payload, entity_id=candidate_id,
        )
    except BaseException:
        await db.rollback()
        raise

    loaded = await _conversion_project(
        db, project_id=entity_id, customer_id=customer_id, contractor_id=contractor_id,
    )
    if created:
        from app.services.outbox_inline_dispatch import dispatch_best_effort

        await dispatch_best_effort(db, source="marketplace.convert", limit=10)
    return creation.ProjectCreateResult(loaded, not created)
