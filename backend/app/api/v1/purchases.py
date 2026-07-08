"""API закупок Renova OS."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import PurchaseStatus, User
from app.services import activity_service as act
from app.services import purchase_service as pur

router = APIRouter(prefix="/projects", tags=["purchases"])


class CreatePurchaseIn(BaseModel):
    material_pick_ids: list[str]
    supplier_name: str | None = None


class StatusIn(BaseModel):
    status: str


def _purchase_status_event(status: PurchaseStatus, items_count: int, stage_count: int) -> tuple[str, str, str | None]:
    if status == PurchaseStatus.delivered:
        return (
            "MaterialDelivered",
            f"Материалы доставлены: {items_count} поз.",
            f"Проверены связанные этапы: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.cancelled:
        return (
            "PurchaseCancelled",
            f"Закупка отменена: {items_count} поз.",
            f"Зависимости этапов пересчитаны: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.ordered:
        return ("MaterialOrdered", f"Материалы заказаны: {items_count} поз.", None)
    if status == PurchaseStatus.paid:
        return ("PurchasePaid", f"Закупка оплачена: {items_count} поз.", None)
    return ("PurchaseUpdated", f"Закупка → {status.value}", None)


@router.get("/{project_id}/purchases")
async def list_purchases(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    items = await pur.list_purchases(db, project_id)
    return [pur.purchase_dict(p) for p in items]


@router.post("/{project_id}/purchases")
async def create_purchase(
    project_id: str,
    body: CreatePurchaseIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    p = await pur.create_from_picks(db, project_id, body.material_pick_ids, body.supplier_name)
    if not p:
        raise HTTPException(400, "Нет материалов для закупки")
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="MaterialOrdered",
        title=f"Закупка создана: {len(body.material_pick_ids)} поз.",
        body=p.supplier_name,
        link_path="/(customer)/(tabs)/materials",
    )
    return pur.purchase_dict(p)


@router.post("/{project_id}/purchases/{purchase_id}/status")
async def update_purchase_status(
    project_id: str,
    purchase_id: str,
    body: StatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        st = PurchaseStatus(body.status)
    except ValueError:
        raise HTTPException(400, "Неверный статус")
    p = await pur.set_status(db, purchase_id, st)
    if not p or p.project_id != project_id:
        raise HTTPException(404)

    items_count = len(p.items or [])
    stage_count = len({i.stage_id for i in (p.items or []) if i.stage_id})
    kind, title, event_body = _purchase_status_event(st, items_count, stage_count)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind=kind,
        title=title,
        body=event_body or p.supplier_name,
        link_path="/(customer)/(tabs)/materials",
    )
    return pur.purchase_dict(p)


@router.post("/{project_id}/material-needs/from-estimate")
async def generate_needs(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    created = await pur.generate_needs_from_estimate(db, project_id)
    if created:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="MaterialCalculated",
            title=f"Материалы из сметы: {len(created)}",
            link_path="/(customer)/(tabs)/materials",
        )
    return {"count": len(created), "created": [{"id": p.id, "name": p.name} for p in created]}
