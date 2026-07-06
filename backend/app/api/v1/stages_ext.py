"""Этапы: детали, комментарии, фото, готовность, даты."""
from datetime import date
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.project import StageCommentIn, StageDatesIn, StagePhotoIn
from app.services import project_service as proj_svc
from app.services import stage_service as stage_svc

router = APIRouter(prefix="/projects", tags=["stages"])
class StageCreate(BaseModel):
    name: str
    planned_start: date | None = None
    planned_end: date | None = None
    room_ids: list[str] | None = None
    work_type: str | None = None


@router.post("/{project_id}/stages")
async def create_stage_route(
    project_id: str,
    body: StageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель создаёт этапы")
    stage = await stage_svc.create_stage(
        db,
        project_id,
        name=body.name,
        planned_start=body.planned_start,
        planned_end=body.planned_end,
        room_ids=body.room_ids,
        work_type=body.work_type,
    )
    if not stage:
        raise HTTPException(404, "Проект не найден")
    return stage_svc.stage_to_dict(stage)





@router.get("/{project_id}/stages/{stage_id}")
async def stage_detail(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
    c = await stage_svc.add_comment(db, stage_id, user.id, user.role.value, body.text)
    return {"id": c.id, "text": c.text, "author_role": c.author_role, "created_at": c.created_at.isoformat()}


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
    p = await stage_svc.add_photo(db, stage_id, user.id, body.image_data, body.caption, storage_key=body.storage_key, image_url=body.image_url)
    return {"id": p.id, "caption": p.caption, "created_at": p.created_at.isoformat()}


@router.get("/{project_id}/stages/{stage_id}/photos/{photo_id}")
async def get_photo(project_id: str, stage_id: str, photo_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    photo = next((p for p in stage.photos if p.id == photo_id), None)
    if not photo:
        raise HTTPException(404, "Фото не найдено")
    return {"id": photo.id, "caption": photo.caption, "image_data": photo.image_data, "created_at": photo.created_at.isoformat()}


@router.post("/{project_id}/stages/{stage_id}/start")
async def start_stage(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    stage, err = await stage_svc.start_stage(db, stage_id)
    if err:
        code = err.get("code")
        if code == "blocked":
            raise HTTPException(409, detail=err)
        raise HTTPException(400, detail=err.get("message", "Не удалось начать этап"))
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    return stage_svc.stage_to_dict(stage)

@router.post("/{project_id}/stages/{stage_id}/ready")
async def mark_ready(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    stage, err = await stage_svc.set_contractor_ready(db, stage_id)
    if err:
        raise HTTPException(400, detail=err)
    if not stage:
        raise HTTPException(404)
    return stage_svc.stage_to_dict(stage)


@router.patch("/{project_id}/stages/{stage_id}/dates")
async def patch_dates(
    project_id: str,
    stage_id: str,
    body: StageDatesIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель планирует даты")
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    stage = await stage_svc.update_stage_dates(db, stage_id, body.planned_start, body.planned_end)
    return stage_svc.stage_to_dict(stage)


@router.get("/{project_id}/plan")
async def project_plan(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    from app.api.v1.projects import _filter_stages_for_user
    stages = _filter_stages_for_user(p, user)
    return {
        "project_id": p.id,
        "name": p.name,
        "property_type": p.property_type,
        "planned_start_date": p.planned_start_date.isoformat() if p.planned_start_date else None,
        "planned_end_date": p.planned_end_date.isoformat() if p.planned_end_date else None,
        "stages": [stage_svc.stage_to_dict(s) for s in stages],
    }


class StageRoomsIn(BaseModel):
    room_ids: list[str] = []


@router.patch("/{project_id}/stages/{stage_id}/rooms")
async def patch_stage_rooms(
    project_id: str,
    stage_id: str,
    body: StageRoomsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    from app.models.entities import Room
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    p = await require_project(db, project_id, user, write=False)
    valid = {r.id for r in (p.rooms or [])}
    ids = [rid for rid in body.room_ids if rid in valid]
    stage = await stage_svc.set_stage_rooms(db, stage_id, ids)
    return stage_svc.stage_to_dict(stage)


class WorkTypeIn(BaseModel):
    work_type: str | None = None

@router.patch("/{project_id}/stages/{stage_id}/work-type")
async def patch_work_type(project_id: str, stage_id: str, body: WorkTypeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Stage
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id: raise HTTPException(404)
    stage.work_type = body.work_type
    await db.commit()
    return {"ok": True, "work_type": stage.work_type}

class DependsIn(BaseModel):
    depends_on_stage_id: str | None = None

@router.patch("/{project_id}/stages/{stage_id}/depends")
async def patch_depends(project_id: str, stage_id: str, body: DependsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Stage, StageStatus
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id: raise HTTPException(404)
    if body.depends_on_stage_id:
        dep = await db.get(Stage, body.depends_on_stage_id)
        if not dep or dep.project_id != project_id: raise HTTPException(400)
        if dep.status != StageStatus.done: raise HTTPException(409, "Предшественник не завершён")
    stage.depends_on_stage_id = body.depends_on_stage_id
    await db.commit()
    return {"ok": True, "depends_on_stage_id": stage.depends_on_stage_id}

@router.get("/{project_id}/stages/{stage_id}/blocked")
async def stage_blocked(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Stage
    from app.services import dependency_service as dep_svc
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    return await dep_svc.evaluate_stage(db, stage)


@router.post("/{project_id}/dependencies/sync")
async def sync_dependencies(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    from app.services import dependency_service as dep_svc
    count = await dep_svc.sync_from_workflow(db, project_id)
    return {"created": count}


@router.get("/{project_id}/dependencies")
async def list_project_dependencies(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    from app.models.entities import Stage, MaterialPick
    from app.services import dependency_service as dep_svc
    deps = await dep_svc.list_dependencies(db, project_id)
    out = []
    for d in deps:
        st = await db.get(Stage, d.stage_id)
        dep_st = await db.get(Stage, d.depends_on_stage_id) if d.depends_on_stage_id else None
        pick = await db.get(MaterialPick, d.depends_on_material_pick_id) if d.depends_on_material_pick_id else None
        out.append(dep_svc.dependency_dict(d, stage_name=st.name if st else None, dep_stage_name=dep_st.name if dep_st else None, material_name=pick.name if pick else None))
    return out
