"""Этапы: детали, комментарии, фото, готовность, даты."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project import StageCommentIn, StageDatesIn, StagePhotoIn
from app.services import stage_mutation_service as mutations
from app.services import stage_review_service
from app.services import stage_service as stage_svc

router = APIRouter(prefix="/projects", tags=["stages"])


class StageCreate(BaseModel):
    name: str
    planned_start: date | None = None
    planned_end: date | None = None
    room_ids: list[str] | None = None
    work_type: str | None = None
    client_request_id: str | None = Field(default=None, max_length=80)


class StageRoomsIn(BaseModel):
    room_ids: list[str] = Field(default_factory=list)


class WorkTypeIn(BaseModel):
    work_type: str | None = None


class DependsIn(BaseModel):
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


@router.post("/{project_id}/stages")
async def create_stage_route(
    project_id: str,
    body: StageCreate,
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
    response = stage_svc.stage_to_dict(result.stage)
    response["replayed"] = result.replayed
    return response


@router.get("/{project_id}/stages/{stage_id}")
async def stage_detail(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    return stage_svc.stage_to_dict(stage)


@router.post("/{project_id}/stages/{stage_id}/comments")
async def add_comment(
    project_id: str,
    stage_id: str,
    body: StageCommentIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    comment = await stage_svc.add_comment(
        db,
        stage_id,
        user.id,
        user.role.value,
        body.text,
    )
    return {
        "id": comment.id,
        "text": comment.text,
        "author_role": comment.author_role,
        "created_at": comment.created_at.isoformat(),
    }


@router.post("/{project_id}/stages/{stage_id}/photos")
async def add_photo(
    project_id: str,
    stage_id: str,
    body: StagePhotoIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    photo = await stage_svc.add_photo(
        db,
        stage_id,
        user.id,
        body.image_data,
        body.caption,
        storage_key=body.storage_key,
        image_url=body.image_url,
    )
    return {
        "id": photo.id,
        "caption": photo.caption,
        "created_at": photo.created_at.isoformat(),
    }


@router.get("/{project_id}/stages/{stage_id}/photos/{photo_id}")
async def get_photo(
    project_id: str,
    stage_id: str,
    photo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    photo = next((item for item in stage.photos if item.id == photo_id), None)
    if not photo:
        raise HTTPException(404, "Фото не найдено")
    return {
        "id": photo.id,
        "caption": photo.caption,
        "image_data": photo.image_data,
        "created_at": photo.created_at.isoformat(),
    }


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
        response = stage_svc.stage_to_dict(result.stage)
        response["replayed"] = result.replayed
        return response
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
    response = stage_svc.stage_to_dict(result.stage)
    response.update(
        {
            "acceptance_id": result.acceptance.id,
            "acceptance_status": result.acceptance.status,
            "replayed": result.replayed,
        }
    )
    return response


@router.patch("/{project_id}/stages/{stage_id}/dates")
async def patch_dates(
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
        raise HTTPException(404, "Этап не найден")
    response = stage_svc.stage_to_dict(result.stage)
    response["replayed"] = result.replayed
    return response


@router.get("/{project_id}/plan")
async def project_plan(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    from app.api.v1.projects import _filter_stages_for_user

    stages = _filter_stages_for_user(project, user)
    return {
        "project_id": project.id,
        "name": project.name,
        "property_type": project.property_type,
        "planned_start_date": (
            project.planned_start_date.isoformat()
            if project.planned_start_date
            else None
        ),
        "planned_end_date": (
            project.planned_end_date.isoformat()
            if project.planned_end_date
            else None
        ),
        "stages": [stage_svc.stage_to_dict(stage) for stage in stages],
    }


@router.patch("/{project_id}/stages/{stage_id}/rooms")
async def patch_stage_rooms(
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
        raise HTTPException(404, "Этап не найден")
    response = stage_svc.stage_to_dict(result.stage)
    response["replayed"] = result.replayed
    return response


@router.patch("/{project_id}/stages/{stage_id}/work-type")
async def patch_work_type(
    project_id: str,
    stage_id: str,
    body: WorkTypeIn,
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
        raise HTTPException(404, "Этап не найден")
    response = stage_svc.stage_to_dict(result.stage)
    response["replayed"] = result.replayed
    return response


@router.patch("/{project_id}/stages/{stage_id}/depends")
async def patch_depends(
    project_id: str,
    stage_id: str,
    body: DependsIn,
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
        raise HTTPException(404, "Этап не найден")
    response = stage_svc.stage_to_dict(result.stage)
    response["replayed"] = result.replayed
    return response


@router.get("/{project_id}/stages/{stage_id}/blocked")
async def stage_blocked(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    from app.models.entities import Stage
    from app.services import dependency_service as dependency_svc

    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    return await dependency_svc.evaluate_stage(
        db,
        stage,
        commit=False,
        persist_status=False,
    )


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


@router.get("/{project_id}/dependencies")
async def list_project_dependencies(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    from app.models.entities import MaterialPick, Stage
    from app.services import dependency_service as dependency_svc

    dependencies = await dependency_svc.list_dependencies(db, project_id)
    output = []
    for dependency in dependencies:
        stage = await db.get(Stage, dependency.stage_id)
        predecessor = (
            await db.get(Stage, dependency.depends_on_stage_id)
            if dependency.depends_on_stage_id
            else None
        )
        material = (
            await db.get(MaterialPick, dependency.depends_on_material_pick_id)
            if dependency.depends_on_material_pick_id
            else None
        )
        output.append(
            dependency_svc.dependency_dict(
                dependency,
                stage_name=stage.name if stage else None,
                dep_stage_name=predecessor.name if predecessor else None,
                material_name=material.name if material else None,
            )
        )
    return output
