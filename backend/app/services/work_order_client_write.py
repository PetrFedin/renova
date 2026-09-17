"""Replay-safe direct WorkOrder creation for offline/response-loss recovery.

This module is deliberately narrow. It composes the existing non-committing
`prepare_work_order()` primitive with the canonical ClientWriteRequest ledger so
one client intent has one WorkOrder/thread/activity graph even when the first
response is lost and the exact request is replayed.
"""
from __future__ import annotations

from datetime import date
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User, WorkOrder
from app.services import team_service, work_order_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

logger = logging.getLogger(__name__)

WORK_ORDER_CREATE_SCOPE = "work_order.create"
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


def _validate_request_id(client_request_id: str) -> None:
    if not isinstance(client_request_id, str) or not _REQUEST_ID.fullmatch(client_request_id):
        raise ValueError("work_order_request_id_invalid")


def _payload(
    *,
    title: str,
    work_type: str,
    room_id: str | None,
    stage_id: str | None,
    planned_start: date | None,
    planned_end: date | None,
    budget_planned: float,
    notes: str | None,
    publish: bool,
) -> dict:
    """Canonical business payload; the request ID itself is not part of its hash."""
    return {
        "title": title,
        "work_type": work_type,
        "room_id": room_id,
        "stage_id": stage_id,
        "planned_start": planned_start.isoformat() if planned_start else None,
        "planned_end": planned_end.isoformat() if planned_end else None,
        "budget_planned": budget_planned,
        "notes": notes,
        "publish": publish,
    }


async def _lock_current_authority(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
) -> tuple[Project, User]:
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if project is None or getattr(project, "trashed_at", None):
        raise ValueError("work_order_project_missing")

    actor = (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if actor is None or getattr(actor, "deleted_at", None):
        raise ValueError("work_order_actor_unavailable")

    if not await team_service.can_access_project(db, actor, project, write=True):
        raise ValueError("work_order_create_forbidden")
    return project, actor


async def _replay_work_order(
    db: AsyncSession,
    *,
    project_id: str,
    work_order_id: str,
) -> WorkOrder:
    work_order = await db.get(WorkOrder, work_order_id)
    if work_order is None or work_order.project_id != project_id:
        raise RuntimeError("work_order_replay_corrupt")
    return work_order


async def create_work_order(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    title: str,
    work_type: str,
    room_id: str | None = None,
    stage_id: str | None = None,
    planned_start: date | None = None,
    planned_end: date | None = None,
    budget_planned: float = 0,
    notes: str | None = None,
    publish: bool = False,
) -> WorkOrder:
    """Create exactly one direct work order for one client intent.

    The Project row lock serializes this operation with project-authority changes.
    The WorkOrder, bound chat thread/system message, durable activity outbox and
    ClientWriteRequest mapping commit as one transaction. Same key + same payload
    replays the canonical WorkOrder; same key + changed payload is rejected by the
    canonical idempotency helper.
    """
    _validate_request_id(client_request_id)
    payload = _payload(
        title=title,
        work_type=work_type,
        room_id=room_id,
        stage_id=stage_id,
        planned_start=planned_start,
        planned_end=planned_end,
        budget_planned=budget_planned,
        notes=notes,
        publish=publish,
    )

    try:
        await _lock_current_authority(db, project_id=project_id, user_id=user_id)
        replay = await replay_entity_id(
            db,
            scope=WORK_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay:
            result = await _replay_work_order(db, project_id=project_id, work_order_id=replay)
            await db.commit()  # release the project authority lock
            return result

        prepared = await work_order_service.prepare_work_order(
            db,
            project_id=project_id,
            user_id=user_id,
            title=title,
            work_type=work_type,
            room_id=room_id,
            stage_id=stage_id,
            planned_start=planned_start,
            planned_end=planned_end,
            budget_planned=budget_planned,
            notes=notes,
            publish=publish,
        )
        created, entity_id = await commit_client_write(
            db,
            scope=WORK_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=prepared.id,
        )
        if not created:
            return await _replay_work_order(db, project_id=project_id, work_order_id=entity_id)
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(prepared)
    try:
        await work_order_service._dispatch_committed_effects(db, source="work_order.create.client_write")
    except Exception:
        # DomainOutbox is already committed. Inline dispatch is only acceleration;
        # it must not turn a committed business write into an apparent rollback.
        logger.exception("work_order inline outbox acceleration failed after commit")
    return prepared
