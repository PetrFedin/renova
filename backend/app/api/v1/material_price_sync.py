"""Canonical, truthful material price read/mutation endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import MaterialPick, User
from app.models import material_price_truth
from app.services import material_pick_service
from app.services import material_price_service
from app.services.price_parser import PriceFetchError

router = APIRouter(prefix="/projects", tags=["materials"])


class ManualPriceIn(BaseModel):
    price: float = Field(ge=0, le=10_000_000)


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
        "price_source": pick.price_source,
        "price_verified": material_price_truth.is_verified_price_source(pick.price_source),
        "price_verified_at": pick.price_verified_at.isoformat() if pick.price_verified_at else None,
        "price_source_url": pick.price_source_url,
        "price_actionable": material_price_truth.is_actionable_purchase_price(pick),
    }


def _material_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "material_pick_not_editable": "Обновлять материал можно только в черновике",
        "material_pick_price_not_editable": "Цена доступна для изменения в черновике или для восстановления согласованной исторической позиции",
        "material_pick_locked_by_purchase": "Материал уже включён в активную закупку",
        "material_pick_price_sync_stale": "Материал изменился во время проверки цены. Запустите обновление повторно",
        "material_pick_price_invalid": "Укажите корректную цену материала",
    }
    return HTTPException(
        409 if code != "material_pick_price_invalid" else 422,
        detail={"code": code, "message": messages.get(code, "Обновление цены недоступно")},
    )


def _price_fetch_error(error: PriceFetchError) -> HTTPException:
    messages = {
        "price_url_invalid": "Некорректная ссылка поставщика",
        "price_url_scheme_forbidden": "Разрешены только HTTP/HTTPS-ссылки",
        "price_url_credentials_forbidden": "Ссылки со встроенными логином или паролем запрещены",
        "price_url_port_forbidden": "Нестандартный сетевой порт запрещён",
        "price_url_private_target": "Ссылка ведёт во внутреннюю или служебную сеть",
        "price_url_unresolvable": "Домен поставщика не найден",
        "price_redirect_limit": "Сайт поставщика создал слишком много перенаправлений",
        "price_response_too_large": "Ответ сайта поставщика превышает допустимый размер",
    }
    return HTTPException(
        422,
        detail={
            "code": error.code,
            "message": messages.get(error.code, "Не удалось безопасно проверить ссылку поставщика"),
        },
    )


@router.get("/{project_id}/material-picks/{pick_id}/price-truth")
async def get_price_truth(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return durable price provenance without implying a live provider check."""
    await require_project(db, project_id, user, write=False)
    pick = await material_pick_service.get_pick(
        db,
        project_id=project_id,
        pick_id=pick_id,
    )
    if pick is None:
        raise HTTPException(404, "Материал не найден")
    return _out(pick)


@router.patch("/{project_id}/material-picks/{pick_id}/price")
async def set_manual_price(
    project_id: str,
    pick_id: str,
    body: ManualPriceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Explicitly set/confirm a price and make its manual provenance durable."""
    await require_project(db, project_id, user, write=True)
    try:
        pick = await material_price_service.set_manual_material_price(
            db,
            project_id=project_id,
            pick_id=pick_id,
            actor_id=user.id,
            price=body.price,
        )
    except ValueError as error:
        raise _material_error(error) from error
    if pick is None:
        raise HTTPException(404, "Материал не найден")
    return _out(pick)


@router.post("/{project_id}/material-picks/{pick_id}/sync-price")
async def sync_price(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Refresh one price-mutable material without fabricated fallbacks or long-held DB locks."""
    await require_project(db, project_id, user, write=True)
    try:
        result = await material_price_service.sync_material_price(
            db,
            project_id=project_id,
            pick_id=pick_id,
            actor_id=user.id,
        )
    except PriceFetchError as error:
        raise _price_fetch_error(error) from error
    except ValueError as error:
        raise _material_error(error) from error
    if result is None:
        raise HTTPException(404, "Материал не найден")

    response = _out(result.pick)
    response.update(
        {
            "price_sync_result": result.source,
            "price_updated": result.price_changed,
            "shop_updated": result.shop_changed,
            "requires_reapproval": result.requires_reapproval,
        }
    )
    return response
