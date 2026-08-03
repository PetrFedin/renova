"""Canonical stage create/start/configuration routes."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import stage_mutation_service as mutations
from app.services import stage_review_service
from app.services import stage_service

router = APIRouter(prefix="/projects", tags=["stages"])


class StageCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    planned_start: date | None = None
    planned_end: date | None = None
    room_ids: list[str] | None = None
    work_type: str | None = Field(default=None, max_length=64)
    client_request_id: str | None = Field(default=None, max_length=80)


class StageDatesIn(BaseModel):
    planned_start: date | None = None
    planned_end: date | None = None


class StageRoomsIn(BaseModel):
    room_ids: list[str] = Field(default_factory=list)


class StageWorkTypeIn(BaseModel):
    work_type: str | None = Field(default=None, max_length=64)


class StageDependencyIn(BaseModel):
    depends_on_stage_id: str | None = None


def _mutation_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {
        "stage_schedule_actor_forbidden",
        "stage_execution_actor_forbidden",
        "stage_submit_actor_forbidden",
    }:
        return HTTPException(403, detail={"code": code})
    if code in {
        "confirmed_schedule_controls_dates",
        "stage_configuration_locked",
        "stage_dependency_cycle",
        "idempotency_conflict",
    }:
        return HTTPException(409, detail={"code": code})
    if code in {"project_not_found", "stage_entity_missing"}:
        return HTTPException(404, detail={"code": code})
    return HTTPException(422, detail={"code": code})


async def _stage_response(
    db: AsyncSession,
    result: mutations.StageMutationResult,
) -> dict:
    loaded = await stage_service.get_stage_full(db, result.stage.id)
    if loaded is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    response = stage_service.stage_to_dict(loaded)
    response["replayed"] = result.replayed
    return response


@router.post("/{project_id}/stages")
async def create_stage(
    project_id: str,
    body: StageCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.create_stage(
            db,
            project_id=project_id,
            actor=user,
            name=body.name,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
            room_ids=body.room_ids,
            work_type=body.work_type,
            client_request_id=body.client_request_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    return await _stage_response(db, result)


@router.post("/{project_id}/stages/{stage_id}/start")
async def start_stage(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result, error = await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
        )
    except ValueError as exc:
        raise _mutation_error(exc) from exc
    if result is not None:
        return await _stage_response(db, result)

    code = (error or {}).get("code", "stage_start_failed")
    if code in {"project_not_found", "stage_not_found"}:
        raise HTTPException(404, detail=error)
    if code in {"contract_not_signed", "contract_required"}:
        raise HTTPException(403, detail=error)
    if code in {"blocked", "stage_start_invalid_status"}:
        raise HTTPException(409, detail=error)
    raise HTTPException(422, detail=error)


@router.post("/{project_id}/stages/{stage_id}/ready")
async def mark_ready(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result, error = await stage_review_service.submit_for_review(
            db,
            project=project,
            stage_id=stage_id,
            actor=user,
        )
    except ValueError as exc:
        raise _mutation_error(exc) from exc
    if result is None:
        if error is None:
            raise HTTPException(404, detail={"code": "stage_not_found"})
        if error.get("code") == "completion_gate":
            raise HTTPException(422, detail=error)
        raise HTTPException(409, detail=error)

    acceptance_id = result.acceptance.id
    acceptance_status = result.acceptance.status
    response = await _stage_response(
        db,
        mutations.StageMutationResult(result.stage, result.replayed),
    )
    response.update(
        {
            "acceptance_id": acceptance_id,
            "acceptance_status": acceptance_status,
        }
    )
    return response


@router.patch("/{project_id}/stages/{stage_id}/dates")
async def update_dates(
    project_id: str,
    stage_id: str,
    body: StageDatesIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_dates(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/rooms")
async def update_rooms(
    project_id: str,
    stage_id: str,
    body: StageRoomsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_rooms(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            room_ids=body.room_ids,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/work-type")
async def update_work_type(
    project_id: str,
    stage_id: str,
    body: StageWorkTypeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_work_type(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            work_type=body.work_type,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/depends")
async def update_dependency(
    project_id: str,
    stage_id: str,
    body: StageDependencyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_dependency(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            depends_on_stage_id=body.depends_on_stage_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.post("/{project_id}/dependencies/sync")
async def sync_dependencies(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        count = await mutations.sync_dependencies(
            db,
            project_id=project_id,
            actor=user,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    return {"created": count}
