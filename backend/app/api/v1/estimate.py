from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import project_service as proj_svc
from app.services.estimate_service import add_line, material_stats, update_line

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


@router.patch("/lines/{line_id}")
async def patch_line(project_id: str, line_id: str, body: LinePatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель редактирует смету")
    await require_project(db, project_id, user, write=True)
    line = await update_line(db, line_id, **body.model_dump(exclude_none=True))
    if not line:
        raise HTTPException(404, "Строка не найдена")
    return {"ok": True, "id": line.id}


@router.post("/lines")
async def create_line(project_id: str, body: LineCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    await require_project(db, project_id, user, write=True)
    line = await add_line(db, project_id, body.model_dump())
    return {"ok": True, "id": line.id}


@router.get("/materials-stats")
async def materials_stats(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    return material_stats(p.estimate_lines)
