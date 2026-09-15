"""Atomic replay-safe generation of material needs from the current estimate."""
from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    DomainOutbox,
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    User,
)
from app.services import material_supply_service
from app.services import outbox_service as outbox
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "material-needs.generate"
AGGREGATE_TYPE = "material_need_generation"
ZERO_RESULT_ID = "00000000-0000-0000-0000-000000000000"


def canonical_payload() -> dict[str, str]:
    return {"source": "estimate"}


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise RuntimeError("material_needs_project_missing")
    return project


async def _revalidate_authority(
    db: AsyncSession,
    *,
    user_id: str,
    project: Project,
) -> User:
    """Re-check project write authority after any wait on the project lock."""
    from fastapi import HTTPException
    from app.services import team_service as team_svc

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if not await team_svc.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")
    return actor


async def _prepare_needs(
    db: AsyncSession,
    *,
    project: Project,
) -> list[MaterialPick]:
    """Prepare missing MaterialPick rows without committing the transaction."""
    generated_source = material_supply_service.default_source_for_project(project)
    lines = list(
        (
            await db.execute(
                select(EstimateLine)
                .where(
                    EstimateLine.project_id == project.id,
                    EstimateLine.line_type == LineType.material,
                )
                .order_by(EstimateLine.id.asc())
            )
        ).scalars().all()
    )
    created: list[MaterialPick] = []
    for line in lines:
        existing = (
            await db.execute(
                select(MaterialPick.id).where(
                    MaterialPick.project_id == project.id,
                    MaterialPick.name == line.name,
                    MaterialPick.room_id == line.room_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue
        pick = MaterialPick(
            project_id=project.id,
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
    if created:
        await db.flush()
    return created


async def _result_snapshot(
    db: AsyncSession,
    *,
    batch_id: str,
) -> list[dict[str, str]]:
    if batch_id == ZERO_RESULT_ID:
        return []
    row = (
        await db.execute(
            select(DomainOutbox).where(
                DomainOutbox.aggregate_type == AGGREGATE_TYPE,
                DomainOutbox.aggregate_id == batch_id,
                DomainOutbox.event_type == outbox.ACTIVITY_EVENT,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise RuntimeError("material_needs_replay_snapshot_missing")
    payload = json.loads(row.payload_json or "{}")
    result = payload.get("result")
    if not isinstance(result, list):
        raise RuntimeError("material_needs_replay_snapshot_invalid")
    snapshot: list[dict[str, str]] = []
    for item in result:
        if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
            raise RuntimeError("material_needs_replay_snapshot_invalid")
        snapshot.append({"id": str(item["id"]), "name": str(item["name"])})
    return snapshot


async def generate_from_estimate(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
) -> tuple[list[dict[str, str]], bool]:
    """Generate missing picks exactly once for one logical client intent."""
    canonical = canonical_payload()
    snapshot: list[dict[str, str]] = []
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_authority(db, user_id=user_id, project=project)

        replay_id = await replay_entity_id(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
        )
        if replay_id:
            snapshot = await _result_snapshot(db, batch_id=replay_id)
            await db.commit()
            return snapshot, True

        created = await _prepare_needs(db, project=project)
        snapshot = [{"id": str(pick.id), "name": str(pick.name)} for pick in created]
        batch_id = str(uuid.uuid4()) if snapshot else ZERO_RESULT_ID

        if snapshot:
            await outbox.enqueue(
                db,
                aggregate_type=AGGREGATE_TYPE,
                aggregate_id=batch_id,
                event_type=outbox.ACTIVITY_EVENT,
                payload={
                    "project_id": project_id,
                    "user_id": user_id,
                    "kind": "MaterialCalculated",
                    "title": f"Материалы из сметы: {len(snapshot)}",
                    "body": None,
                    "link_path": "/(customer)/(tabs)/repair?tab=materials",
                    "result": snapshot,
                },
            )

        committed, canonical_batch_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=batch_id,
        )
        if not committed:
            snapshot = await _result_snapshot(db, batch_id=canonical_batch_id)
            await db.commit()
            return snapshot, True
    except BaseException:
        await db.rollback()
        raise

    if snapshot:
        from app.services.outbox_inline_dispatch import dispatch_best_effort

        await dispatch_best_effort(db, source="material-needs.generate", limit=10)
    return snapshot, False
