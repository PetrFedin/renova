"""Этапы: детали, комментарии, фото и read models.

Legacy mutation functions remain import-compatible, but delegate to the canonical
stage mutation router so direct calls cannot bypass ACL, locks or response loading.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.api.v1 import stage_mutations as canonical
from app.db.session import get_db
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.schemas.project import StageCommentIn, StageDatesIn, StagePhotoIn
from app.services import stage_mutation_service as stage_mutation_svc
from app.services import stage_review_service as stage_review_svc
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


async def stage_schedule_capability(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> bool:
    """Project-level schedule capability derived from the canonical mutation ACL."""
    try:
        await stage_mutation_svc._require_schedule_actor(
            db,
            project=project,
            actor=actor,
        )
        return True
    except ValueError as exc:
        if str(exc) != "stage_schedule_actor_forbidden":
            raise
        return False


async def stage_detail_capabilities(
    db: AsyncSession,
    *,
    project: Project,
    stage: Stage,
    actor: User,
) -> dict[str, bool]:
    """Read-only action hints derived from the same canonical ACL validators as mutations.

    The client treats missing/false capabilities as fail-closed. Backend mutation ACLs
    remain authoritative; these flags only prevent the UI from inventing role rules.
    """
    can_schedule = await stage_schedule_capability(db, project=project, actor=actor)

    can_execute = False
    try:
        stage_mutation_svc._require_execution_actor(project, stage, actor)
        can_execute = True
    except ValueError as exc:
        if str(exc) != "stage_execution_actor_forbidden":
            raise

    can_submit = False
    try:
        stage_review_svc._require_submit_actor(project, stage, actor)
        can_submit = True
    except ValueError as exc:
        if str(exc) != "stage_submit_actor_forbidden":
            raise

    status = stage.status if isinstance(stage.status, StageStatus) else StageStatus(str(stage.status))
    can_review = (
        actor.role == UserRole.customer
        and actor.id == project.customer_id
        and status == StageStatus.review
    )
    return {
        "can_schedule": can_schedule,
        "can_start": can_execute and status == StageStatus.planned,
        "can_submit_for_review": can_submit and status == StageStatus.active,
        "can_review": can_review,
        "payment_expected_on_accept": (
            not stage_mutation_svc.is_self_managed_project(project)
            and bool(stage.payment_amount and stage.payment_amount > 0)
        ),
    }


@router.post("/{project_id}/stages")
async def create_stage_route(
    project_id: str,
    body: StageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await canonical.create_stage(
        project_id,
        canonical.StageCreateIn(
            name=body.name,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
            room_ids=body.room_ids,
            work_type=body.work_type,
            client_request_id=body.client_request_id,
        ),
        user=user,
        db=db,
    )


@router.get("/{project_id}/stages/{stage_id}")
async def stage_detail(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    payload = stage_svc.stage_to_dict(stage)
    payload["capabilities"] = await stage_detail_capabilities(
        db,
        project=project,
        stage=stage,
        actor=user,
    )
    return payload


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
    return await canonical.start_stage(project_id, stage_id, user=user, db=db)


@router.post("/{project_id}/stages/{stage_id}/ready")
async def mark_ready(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await canonical.mark_ready(project_id, stage_id, user=user, db=db)


@router.patch("/{project_id}/stages/{stage_id}/dates")
async def patch_dates(
    project_id: str,
    stage_id: str,
    body: StageDatesIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await canonical.update_dates(
        project_id,
        stage_id,
        canonical.StageDatesIn(
            planned_start=body.planned_start,
            planned_end=body.planned_end,
        ),
        user=user,
        db=db,
    )


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
        "capabilities": {
            "can_schedule": await stage_schedule_capability(
                db,
                project=project,
                actor=user,
            )
        },
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
    return await canonical.update_rooms(
        project_id,
        stage_id,
        canonical.StageRoomsIn(room_ids=body.room_ids),
        user=user,
        db=db,
    )


@router.patch("/{project_id}/stages/{stage_id}/work-type")
async def patch_work_type(
    project_id: str,
    stage_id: str,
    body: WorkTypeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await canonical.update_work_type(
        project_id,
        stage_id,
        canonical.StageWorkTypeIn(work_type=body.work_type),
        user=user,
        db=db,
    )


@router.patch("/{project_id}/stages/{stage_id}/depends")
async def patch_depends(
    project_id: str,
    stage_id: str,
    body: DependsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await canonical.update_dependency(
        project_id,
        stage_id,
        canonical.StageDependencyIn(
            depends_on_stage_id=body.depends_on_stage_id,
        ),
        user=user,
        db=db,
    )


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
    return await canonical.sync_dependencies(project_id, user=user, db=db)


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
