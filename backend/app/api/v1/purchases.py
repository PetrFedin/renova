"""API закупок Renova OS."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, PurchaseStatus, User
from app.services import activity_service as act
from app.services import notification_service as notif
from app.services import purchase_service as pur

router = APIRouter(prefix="/projects", tags=["purchases"])


class CreatePurchaseIn(BaseModel):
    material_pick_ids: list[str]
    supplier_name: str | None = None


class StatusIn(BaseModel):
    status: str


def _project_member_ids(project: Project) -> list[str]:
    ids = [project.customer_id, project.contractor_id, project.foreman_id]
    seen: set[str] = set()
    result: list[str] = []
    for user_id in ids:
        if user_id and user_id not in seen:
            seen.add(user_id)
            result.append(user_id)
    return result


async def _notify_purchase_status(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    status: PurchaseStatus,
    title: str,
    body: str | None,
) -> None:
    if status not in {
        PurchaseStatus.delivered,
        PurchaseStatus.cancelled,
        PurchaseStatus.returned,
    }:
        return
    for user_id in _project_member_ids(project):
        if user_id == actor_id:
            continue
        await notif.notify(
            db,
            user_id=user_id,
            project_id=project.id,
            notification_type="materials",
            title=title,
            body=body or "Откройте материалы и проверьте, как это влияет на ближайшие этапы.",
            link_path="/(customer)/(tabs)/repair?tab=materials",
            return_to="/(customer)/(tabs)/home",
        )


@router.get("/{project_id}/purchases")
async def list_purchases(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    items = await pur.list_purchases(db, project_id)
    return [pur.purchase_dict(purchase) for purchase in items]


@router.post("/{project_id}/purchases")
async def create_purchase(
    project_id: str,
    body: CreatePurchaseIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        purchase = await pur.create_from_picks(
            db,
            project_id,
            body.material_pick_ids,
            body.supplier_name,
        )
    except ValueError as error:
        if str(error) == "picks_not_approved":
            raise HTTPException(
                409,
                detail={
                    "code": "picks_not_approved",
                    "message": "Сначала согласуйте материалы с заказчиком",
                },
            ) from error
        raise
    if not purchase:
        raise HTTPException(400, "Нет материалов для закупки")
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="MaterialOrdered",
        title=f"Закупка создана: {len(body.material_pick_ids)} поз.",
        body=purchase.supplier_name,
        link_path="/(customer)/(tabs)/repair?tab=materials",
    )
    return pur.purchase_dict(purchase)


@router.post("/{project_id}/purchases/{purchase_id}/status")
async def update_purchase_status(
    project_id: str,
    purchase_id: str,
    body: StatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        status = PurchaseStatus(body.status)
    except ValueError as error:
        raise HTTPException(400, "Неверный статус") from error

    try:
        purchase, changed = await pur.transition_status(
            db,
            project_id=project_id,
            purchase_id=purchase_id,
            status=status,
            actor_id=user.id,
        )
    except ValueError as error:
        code = str(error)
        messages = {
            "purchase_transition_terminal": "Завершённую закупку нельзя перевести в другой статус",
            "purchase_return_requires_delivery": "Вернуть можно только доставленные материалы",
            "purchase_transition_invalid": "Недопустимый обратный переход статуса закупки",
        }
        raise HTTPException(
            409,
            detail={"code": code, "message": messages.get(code, "Недопустимый переход статуса")},
        ) from error

    if not purchase:
        raise HTTPException(404)
    if not changed:
        response = pur.purchase_dict(purchase)
        response["replayed"] = True
        return response

    items_count = len(purchase.items or [])
    stage_count = len({item.stage_id for item in (purchase.items or []) if item.stage_id})
    kind, title, event_body = pur.purchase_status_event(status, items_count, stage_count)

    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind=kind,
            title=title,
            body=event_body or purchase.supplier_name,
            link_path="/(customer)/(tabs)/repair?tab=materials",
        )
        await _notify_purchase_status(
            db,
            project=project,
            actor_id=user.id,
            status=status,
            title=title,
            body=event_body,
        )
    finally:
        clear_request_side_effect_context()

    response = pur.purchase_dict(purchase)
    response["replayed"] = False
    return response


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
            link_path="/(customer)/(tabs)/repair?tab=materials",
        )
    return {"count": len(created), "created": [{"id": pick.id, "name": pick.name} for pick in created]}
