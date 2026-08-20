from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import technical_supervision_service as supervision

router = APIRouter(
    prefix="/projects/{project_id}/technical-supervision",
    tags=["technical-supervision"],
)


class TechnicalSupervisionAssignmentIn(BaseModel):
    profile_code: str = Field(min_length=1, max_length=8)
    provider_type: Literal["individual", "company"]
    provider_name: str | None = Field(default=None, max_length=255)
    expected_assignment_id: str | None = Field(default=None, max_length=36)


class TechnicalSupervisionAssignmentOut(BaseModel):
    id: str
    project_id: str
    provider_type: Literal["individual", "company"]
    provider_name: str
    representative_user_id: str
    representative_full_name: str | None = None
    representative_profile_code: str | None = None
    appointed_by_user_id: str
    appointed_at: str | None = None
    revoked_at: str | None = None
    revoked_by_user_id: str | None = None
    supersedes_assignment_id: str | None = None


class TechnicalSupervisionStatusOut(BaseModel):
    active: TechnicalSupervisionAssignmentOut | None = None
    access_mode: str
    capabilities: list[str] = Field(default_factory=list)


class TechnicalSupervisionMutationOut(BaseModel):
    active: TechnicalSupervisionAssignmentOut | None = None
    replayed: bool


def _http_error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code == "technical_supervision_project_not_found":
        return HTTPException(404, detail={"code": code, "message": "Проект не найден"})
    if code == "technical_supervision_customer_only":
        return HTTPException(
            403,
            detail={
                "code": code,
                "message": "Технический надзор назначает только заказчик-владелец объекта",
            },
        )
    if code == "technical_supervision_representative_not_found":
        return HTTPException(
            404,
            detail={
                "code": code,
                "message": "Представитель не найден. Он должен войти в Renova и передать код профиля.",
            },
        )
    if code in {
        "technical_supervision_customer_conflict",
        "technical_supervision_contractor_conflict",
        "technical_supervision_contractor_team_conflict",
    }:
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Технадзор должен быть независим от заказчика и назначенной бригады исполнителя.",
            },
        )
    if code == "technical_supervision_assignment_changed":
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Назначение уже изменилось. Обновите данные перед повторной операцией.",
            },
        )
    if code in {
        "technical_supervision_profile_code_invalid",
        "technical_supervision_provider_type_invalid",
        "technical_supervision_company_name_required",
        "technical_supervision_provider_name_invalid",
    }:
        return HTTPException(
            422,
            detail={"code": code, "message": "Проверьте данные технического надзора"},
        )
    return HTTPException(409, detail={"code": code, "message": "Операция недоступна"})


async def _active_out(
    db: AsyncSession, project_id: str
) -> TechnicalSupervisionAssignmentOut | None:
    row = await supervision.active_assignment(db, project_id)
    if row is None:
        return None
    row, representative = await supervision.assignment_with_representative(db, row)
    return TechnicalSupervisionAssignmentOut(
        **supervision.assignment_dict(row, representative)
    )


@router.get("", response_model=TechnicalSupervisionStatusOut)
async def get_technical_supervision(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    mode, _read_only, capabilities = await supervision.project_access_descriptor(
        db, user=user, project=project
    )
    return TechnicalSupervisionStatusOut(
        active=await _active_out(db, project_id),
        access_mode=mode,
        capabilities=capabilities,
    )


@router.get("/history", response_model=list[TechnicalSupervisionAssignmentOut])
async def get_technical_supervision_history(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    if user.id != project.customer_id:
        raise HTTPException(403, "technical_supervision_history_customer_only")
    return [
        TechnicalSupervisionAssignmentOut(
            **supervision.assignment_dict(row, representative)
        )
        for row, representative in await supervision.history(db, project_id)
    ]


@router.put("", response_model=TechnicalSupervisionMutationOut)
async def put_technical_supervision(
    project_id: str,
    body: TechnicalSupervisionAssignmentIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.customer_id:
        raise HTTPException(403, "technical_supervision_customer_only")
    try:
        result = await supervision.appoint_or_replace(
            db,
            project_id=project_id,
            actor=user,
            profile_code=body.profile_code,
            provider_type=body.provider_type,
            provider_name=body.provider_name,
            expected_assignment_id=body.expected_assignment_id,
        )
    except ValueError as exc:
        raise _http_error(exc) from exc
    if result.assignment is None:
        raise HTTPException(409, "technical_supervision_assignment_missing")
    return TechnicalSupervisionMutationOut(
        active=TechnicalSupervisionAssignmentOut(
            **supervision.assignment_dict(result.assignment, result.representative)
        ),
        replayed=result.replayed,
    )


@router.delete("", response_model=TechnicalSupervisionMutationOut)
async def delete_technical_supervision(
    project_id: str,
    expected_assignment_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.customer_id:
        raise HTTPException(403, "technical_supervision_customer_only")
    try:
        result = await supervision.revoke(
            db,
            project_id=project_id,
            actor=user,
            expected_assignment_id=expected_assignment_id,
        )
    except ValueError as exc:
        raise _http_error(exc) from exc
    return TechnicalSupervisionMutationOut(active=None, replayed=result.replayed)
