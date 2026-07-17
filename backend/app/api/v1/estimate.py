from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.models.entities import Project
from app.services import project_service as proj_svc
from app.services.estimate_service import add_line, material_stats, update_line, lock_estimate

router = APIRouter(prefix="/projects/{project_id}/estimate", tags=["estimate"])


class LinePatch(BaseModel):
    quantity_planned: float | None = None
    unit_price: float | None = None
    quantity_actual: float | None = None


class LineCreate(BaseModel):
    line_type: str = Field(pattern="^(material|work)$")
    name: str
    unit: str = "pcs"
    quantity_planned: float = Field(gt=0)
    unit_price: float = Field(ge=0)
    room_name: str | None = None


async def _require_estimate_editable(db, project_id: str):
    proj = await db.get(Project, project_id)
    if proj and proj.estimate_locked_at:
        raise HTTPException(409, detail={"code": "estimate_locked", "message": "Смета зафиксирована — правки через изменение сметы (CO)"})




@router.patch("/lines/{line_id}")
async def patch_line(project_id: str, line_id: str, body: LinePatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель редактирует смету")
    await require_project(db, project_id, user, write=True)
    await _require_estimate_editable(db, project_id)
    line = await update_line(db, line_id, **body.model_dump(exclude_none=True))
    if not line:
        raise HTTPException(404, "Строка не найдена")
    return {"ok": True, "id": line.id}


@router.post("/lines")
async def create_line(project_id: str, body: LineCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    await require_project(db, project_id, user, write=True)
    await _require_estimate_editable(db, project_id)
    line = await add_line(db, project_id, body.model_dump())
    return {"ok": True, "id": line.id}


@router.get("/materials-stats")
async def materials_stats(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    return material_stats(p.estimate_lines)


@router.post("/lock")
async def lock_project_estimate(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель фиксирует смету")
    await require_project(db, project_id, user, write=True)
    proj, result = await lock_estimate(db, project_id, locked_by=user.id)
    if not proj:
        code = result.get("code")
        if code == "empty_estimate":
            raise HTTPException(400, detail=result)
        raise HTTPException(404, "Проект не найден")
    if result.get("code") == "already_locked":
        raise HTTPException(409, detail=result)
    return {
        "ok": True,
        "estimate_locked_at": proj.estimate_locked_at.isoformat() if proj.estimate_locked_at else None,
        "contract": result.get("contract"),
    }
