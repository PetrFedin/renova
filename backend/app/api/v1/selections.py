"""P2.2 Selections tracker — чистовые материалы (room × category × approve)."""
from app.core.timeutil import utc_now
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, Room, SelectionItem, SelectionStatus, User, UserRole
from app.services import activity_service as act
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(prefix="/projects", tags=["selections"])

CATEGORIES = ("tile", "plumbing", "lighting", "doors", "kitchen", "paint", "other")

SELECTION_CREATE_SCOPE = "selection.create"


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


async def _validate_room_id(db: AsyncSession, *, project_id: str, room_id: str | None) -> None:
    """Bind an optional room_id to the authorized path project before any side effects.

    Missing/foreign room is a privacy-preserving 404 — must be raised before any
    Selection row, activity/outbox event or ClientWriteRequest is committed.
    """
    if not room_id:
        return
    value = (
        await db.execute(
            select(Room.id).where(Room.id == room_id, Room.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not value:
        raise HTTPException(404)


class SelectionIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    room_id: str | None = None
    category: str = "other"
    sku: str | None = None
    allowance: float | None = Field(default=None, ge=0, le=10_000_000)
    price: float = Field(default=0, ge=0, le=10_000_000)
    shop_url: str | None = None
    shop_name: str | None = None
    notes: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class SelectionApproveIn(BaseModel):
    """EST-013: количество и единица для закупки (у подбора их нет в схеме)."""

    qty: float | None = Field(default=None, gt=0, le=1_000_000)
    unit: str | None = Field(default=None, min_length=1, max_length=16)


class SelectionRejectIn(BaseModel):
    reason: str | None = None


def _out(row: SelectionItem) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "room_id": row.room_id,
        "category": row.category,
        "title": row.title,
        "sku": row.sku,
        "allowance": row.allowance,
        "price": row.price,
        "shop_url": row.shop_url,
        "shop_name": row.shop_name,
        "status": row.status.value if hasattr(row.status, "value") else row.status,
        "notes": row.notes,
        "proposed_by_id": row.proposed_by_id,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "over_allowance": bool(row.allowance and row.price > row.allowance),
    }


@router.get("/{project_id}/selections/pending-count")
async def selections_pending_count(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    q = select(func.count()).select_from(SelectionItem).where(
        SelectionItem.project_id == project_id,
        SelectionItem.status == SelectionStatus.proposed,
    )
    count = (await db.execute(q)).scalar_one()
    return {"count": int(count or 0)}


@router.get("/{project_id}/selections")
async def list_selections(
    project_id: str,
    room_id: str | None = None,
    category: str | None = None,
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    q = select(SelectionItem).where(SelectionItem.project_id == project_id)
    if room_id:
        q = q.where(SelectionItem.room_id == room_id)
    if category:
        q = q.where(SelectionItem.category == category)
    if status:
        q = q.where(SelectionItem.status == status)
    rows = (await db.execute(q.order_by(SelectionItem.created_at.desc()))).scalars().all()
    return [_out(r) for r in rows]


@router.post("/{project_id}/selections")
async def create_selection(
    project_id: str,
    body: SelectionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if body.category not in CATEGORIES:
        raise HTTPException(422, "invalid_category")
    await _validate_room_id(db, project_id=project_id, room_id=body.room_id)

    payload = body.model_dump(exclude={"client_request_id"})
    try:
        replay_id = await replay_entity_id(
            db,
            scope=SELECTION_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc

    if replay_id:
        existing = await db.get(SelectionItem, replay_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _out(existing)

    row = SelectionItem(
        project_id=project_id,
        room_id=body.room_id,
        category=body.category,
        title=body.title.strip(),
        sku=body.sku,
        allowance=body.allowance,
        price=body.price,
        shop_url=body.shop_url,
        shop_name=body.shop_name,
        notes=body.notes,
        proposed_by_id=user.id,
        status=SelectionStatus.draft,
    )
    db.add(row)
    await db.flush()
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=SELECTION_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=row.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc

    if not created:
        existing = await db.get(SelectionItem, entity_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _out(existing)

    await db.refresh(row)
    # The Design/selection activity event was already enqueued atomically with
    # the SelectionItem + ClientWriteRequest commit above (see
    # client_write_side_effects.prepare_client_write_side_effects, scope
    # "selection.create") — no separate post-create commit boundary here.
    from app.services.client_write_side_effects import clear_request_side_effect_context
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    clear_request_side_effect_context()
    await dispatch_best_effort(db, source=SELECTION_CREATE_SCOPE, limit=10)
    return _out(row)


@router.post("/{project_id}/selections/{selection_id}/propose")
async def propose_selection(
    project_id: str,
    selection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    row = await db.get(SelectionItem, selection_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404)
    if row.status not in (SelectionStatus.draft, SelectionStatus.rejected):
        raise HTTPException(409, "invalid_status")
    row.status = SelectionStatus.proposed
    row.proposed_by_id = user.id
    await db.commit()
    proj = await db.get(Project, project_id)
    if proj and proj.customer_id:
        from app.services import notification_service as ns

        await ns.notify(
            db,
            user_id=proj.customer_id,
            project_id=project_id,
            notification_type="approval",
            title="Подбор на согласование",
            body=row.title,
            link_path="/(customer)/(tabs)/repair?tab=selections",
        )
    return _out(row)


@router.post("/{project_id}/selections/{selection_id}/approve")
async def approve_selection(
    project_id: str,
    selection_id: str,
    body: SelectionApproveIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Только заказчик")
    row = await db.get(SelectionItem, selection_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404)
    if row.status != SelectionStatus.proposed:
        raise HTTPException(409, "not_proposed")
    # Defense in depth: re-bind room_id to the authorized path project before
    # the approval side effect (MaterialPick creation) can run — a foreign
    # room_id must never have been on the row, but this guarantees a
    # cross-project Selection can never propagate into procurement truth.
    await _validate_room_id(db, project_id=project_id, room_id=row.room_id)
    row.status = SelectionStatus.approved
    row.approved_at = utc_now()
    from app.services.selection_service import material_pick_from_selection

    pick = await material_pick_from_selection(
        db, row, qty=body.qty if body else None, unit=body.unit if body else None
    )
    await db.commit()
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="approval",
        title=f"Подбор согласован: {row.title}",
        body=f"→ закупка {pick.id[:8]}",
        room_id=row.room_id,
        link_path="/(customer)/(tabs)/repair?tab=materials&subtab=picks",
    )
    out = _out(row)
    out["material_pick_id"] = pick.id
    return out


@router.post("/{project_id}/selections/{selection_id}/reject")
async def reject_selection(
    project_id: str,
    selection_id: str,
    body: SelectionRejectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Только заказчик")
    row = await db.get(SelectionItem, selection_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404)
    if row.status != SelectionStatus.proposed:
        raise HTTPException(409, "not_proposed")
    row.status = SelectionStatus.rejected
    if body.reason:
        row.notes = (row.notes or "") + f"\n[отклонено] {body.reason.strip()}"
    await db.commit()
    return _out(row)
