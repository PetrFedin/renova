"""P0 #316: atomic, serialized generation of material needs from estimate."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import EstimateLine, LineType, MaterialPick, MaterialPickStatus, Project, User
from app.services import material_supply_service
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(tags=["purchases"])
MATERIAL_NEEDS_CREATE_SCOPE = "material_needs.from_estimate"


class GenerateMaterialNeedsIn(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80)


def _idempotency_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


async def _lock_project(db: AsyncSession, project_id: str) -> Project | None:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


@router.post("/projects/{project_id}/material-needs/from-estimate")
async def generate_material_needs_integrity(
    project_id: str,
    body: GenerateMaterialNeedsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    payload = {"source": "estimate"}

    try:
        replay_id = await replay_entity_id(
            db,
            scope=MATERIAL_NEEDS_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as error:
        raise _idempotency_error() from error

    if replay_id:
        if replay_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return {"count": 0, "created": [], "replayed": True}

    # The project row is the batch-level serialization primitive. Concurrent
    # generators on PostgreSQL cannot both pass the existence check for the
    # same estimate-derived material need.
    project = await _lock_project(db, project_id)
    if not project:
        raise HTTPException(404, detail={"code": "project_not_found"})
    generated_source = material_supply_service.default_source_for_project(project)

    lines = list(
        (
            await db.execute(
                select(EstimateLine).where(
                    EstimateLine.project_id == project_id,
                    EstimateLine.line_type == LineType.material,
                )
            )
        ).scalars().all()
    )
    created: list[MaterialPick] = []
    for line in lines:
        existing = await db.scalar(
            select(MaterialPick).where(
                MaterialPick.project_id == project_id,
                MaterialPick.name == line.name,
                MaterialPick.room_id == line.room_id,
            )
        )
        if existing:
            continue
        pick = MaterialPick(
            project_id=project_id,
            room_id=line.room_id,
            name=line.name,
            qty=line.quantity_planned,
            qty_needed=line.quantity_planned,
            unit=line.unit,
            price=line.unit_price,
            price_source="estimate" if float(line.unit_price or 0) > 0 else "unset",
            category=line.category or "materials",
            work_type=line.category,
            status=MaterialPickStatus.draft,
            supply_source=generated_source,
            qty_available=0,
            notes="Из сметы",
        )
        db.add(pick)
        created.append(pick)

    try:
        if created:
            await db.flush()
            await outbox.enqueue(
                db,
                aggregate_type="material_needs",
                aggregate_id=project_id,
                event_type=outbox.ACTIVITY_EVENT,
                payload={
                    "project_id": project_id,
                    "user_id": user.id,
                    "kind": "MaterialCalculated",
                    "title": f"Материалы из сметы: {len(created)}",
                    "body": None,
                    "link_path": "/(customer)/(tabs)/repair?tab=materials",
                },
            )
        created_new, entity_id = await commit_client_write(
            db,
            scope=MATERIAL_NEEDS_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=project_id,
        )
    except IdempotencyConflict as error:
        await db.rollback()
        raise _idempotency_error() from error
    except BaseException:
        await db.rollback()
        raise

    if not created_new:
        if entity_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return {"count": 0, "created": [], "replayed": True}

    for pick in created:
        await db.refresh(pick)
    if created:
        from app.services.outbox_inline_dispatch import dispatch_best_effort

        await dispatch_best_effort(db, source="material_needs.from_estimate", limit=10)

    return {
        "count": len(created),
        "created": [{"id": pick.id, "name": pick.name} for pick in created],
        "replayed": False,
    }
