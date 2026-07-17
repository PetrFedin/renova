"""P2.2 Selections tracker — чистовые материалы (room × category × approve)."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, SelectionItem, SelectionStatus, User, UserRole
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["selections"])

CATEGORIES = ("tile", "plumbing", "lighting", "doors", "kitchen", "paint", "other")


class SelectionIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    room_id: str | None = None
    category: str = "other"
    sku: str | None = None
    allowance: float | None = None
    price: float = 0
    shop_url: str | None = None
    shop_name: str | None = None
    notes: str | None = None


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
    await db.commit()
    await db.refresh(row)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="selection",
        title=f"Подбор: {row.title}",
        body=row.category,
        room_id=row.room_id,
        link_path="/(customer)/(tabs)/repair?tab=selections",
    )
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
    row.status = SelectionStatus.approved
    row.approved_at = datetime.utcnow()
    await db.commit()
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="approval",
        title=f"Подбор согласован: {row.title}",
        room_id=row.room_id,
        link_path="/(customer)/(tabs)/repair?tab=selections",
    )
    return _out(row)


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
