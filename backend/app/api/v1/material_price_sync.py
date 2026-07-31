"""Canonical material price refresh without demo or fabricated values."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import MaterialPick, User
from app.services import material_pick_service as pick_svc
from app.services.price_parser import PriceUnavailable, fetch_price

router = APIRouter(prefix="/projects", tags=["materials"])


def _out(pick: MaterialPick) -> dict:
    return {
        "id": pick.id,
        "name": pick.name,
        "room_id": pick.room_id,
        "qty": pick.qty,
        "unit": pick.unit,
        "price": pick.price,
        "shop_url": pick.shop_url,
        "shop_name": pick.shop_name,
        "work_type": pick.work_type,
        "status": pick.status.value,
        "analog_of_id": pick.analog_of_id,
        "notes": pick.notes,
        "total": round(pick.qty * pick.price, 2),
    }


def _transition_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "material_pick_not_editable": "Изменять можно только черновик материала",
        "material_pick_locked_by_purchase": "Материал уже включён в активную закупку",
    }
    return HTTPException(
        409,
        detail={
            "code": code,
            "message": messages.get(code, "Обновление цены недоступно"),
        },
    )


@router.post("/{project_id}/material-picks/{pick_id}/sync-price")
async def sync_material_price(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        pick = await pick_svc.require_editable_pick(
            db,
            project_id=project_id,
            pick_id=pick_id,
        )
    except ValueError as error:
        raise _transition_error(error) from error
    if not pick:
        raise HTTPException(404, "material_pick_not_found")
    if not pick.shop_url:
        raise HTTPException(
            409,
            detail={
                "code": "price_source_required",
                "message": "Добавьте ссылку на товар. Ручная цена сохранена без изменений.",
                "current_price": pick.price,
            },
        )

    try:
        price, shop, source = await fetch_price(pick.shop_url, pick.price)
    except PriceUnavailable as error:
        raise HTTPException(
            424,
            detail={
                "code": error.code,
                "message": "Не удалось подтвердить актуальную цену. Текущая цена не изменена.",
                "current_price": pick.price,
            },
        ) from error

    pick.price = price
    if shop != "generic":
        pick.shop_name = shop
    await db.commit()
    await db.refresh(pick)
    response = _out(pick)
    response.update(
        {
            "price_source": source,
            "price_updated": True,
        }
    )
    return response
