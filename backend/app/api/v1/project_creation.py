"""Canonical atomic endpoints for custom and template project creation."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.projects import _detail
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.project import ProjectCreate, ProjectDetail
from app.services import project_create_service as creation
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreateIn(ProjectCreate):
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class ProjectFromTemplateIn(BaseModel):
    template_id: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=255)
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


def _creation_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "unknown_template": "Неизвестный шаблон объекта",
        "project_rooms_required": "Добавьте хотя бы одну комнату",
        "project_name_invalid": "Укажите корректное название объекта",
        "project_type_invalid": "Укажите корректный тип объекта и ремонта",
        "project_area_invalid": "Площадь объекта должна быть больше нуля",
        "project_dates_invalid": "Дата завершения не может быть раньше даты начала",
        "project_schedule_too_short": "Срок проекта слишком короткий для обязательных этапов",
        "project_stages_required": "Для выбранного типа ремонта не настроены этапы",
        "project_stage_weights_invalid": "Некорректно настроены веса этапов",
        "project_schedule_allocation_invalid": "Не удалось распределить этапы по сроку проекта",
        "project_creation_entity_missing": "Созданный объект не найден после фиксации",
        "idempotency_entity_missing": "Ранее созданный объект больше недоступен",
    }
    if code.startswith("project_room_invalid:"):
        message = "Проверьте размеры и параметры комнат"
        status = 422
    elif code in {"project_creation_entity_missing", "idempotency_entity_missing"}:
        message = messages[code]
        status = 409
    elif code == "unknown_template":
        message = messages[code]
        status = 404
    else:
        message = messages.get(code, "Не удалось создать объект")
        status = 422
    return HTTPException(status, detail={"code": code, "message": message})


def _idempotency_error(_error: IdempotencyConflict) -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Идентификатор запроса уже использован для другого объекта",
        },
    )


@router.post("", response_model=ProjectDetail)
async def create_project(
    body: ProjectCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, "Создавать проект может только заказчик")
    try:
        result = await creation.create_project(
            db,
            customer_id=user.id,
            name=body.name,
            address=body.address,
            renovation_type=body.renovation_type,
            property_type=body.property_type,
            total_area_sqm=body.total_area_sqm,
            planned_start_date=body.planned_start_date,
            planned_end_date=body.planned_end_date,
            rooms_data=[room.model_dump() for room in body.rooms],
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as error:
        raise _idempotency_error(error) from error
    except ValueError as error:
        raise _creation_error(error) from error
    return await _detail(db, result.project, user)


@router.post("/from-template", response_model=ProjectDetail)
async def create_from_template(
    body: ProjectFromTemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, "Создавать проект может только заказчик")
    try:
        result = await creation.create_from_template(
            db,
            customer_id=user.id,
            template_id=body.template_id,
            name=body.name,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as error:
        raise _idempotency_error(error) from error
    except ValueError as error:
        raise _creation_error(error) from error
    return await _detail(db, result.project, user)
