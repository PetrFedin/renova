"""Черновик проекта — заметки до оформления задач и расходов."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import scratchpad_service as sp

router = APIRouter(prefix="/projects", tags=["scratchpad"])


class ScratchpadCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ScratchpadPatch(BaseModel):
    text: str | None = None
    done: bool | None = None
    promoted_kind: str | None = None
    promoted_id: str | None = None


@router.get("/{project_id}/scratchpad")
async def list_scratchpad(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    return {"lines": await sp.list_lines(db, project_id)}


@router.post("/{project_id}/scratchpad")
async def create_scratchpad_line(
    project_id: str,
    body: ScratchpadCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        line = await sp.create_line(db, project_id, user.id, body.text)
    except ValueError:
        raise HTTPException(400, "Пустая строка")
    await db.commit()
    return line


@router.patch("/{project_id}/scratchpad/{line_id}")
async def patch_scratchpad_line(
    project_id: str,
    line_id: str,
    body: ScratchpadPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    line = await sp.get_line(db, line_id)
    if not line or line.project_id != project_id:
        raise HTTPException(404)
    line = await sp.update_line(db, line, body.model_dump(exclude_unset=True))
    await db.commit()
    return sp.line_dict(line)


@router.delete("/{project_id}/scratchpad/{line_id}")
async def delete_scratchpad_line(
    project_id: str,
    line_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    line = await sp.get_line(db, line_id)
    if not line or line.project_id != project_id:
        raise HTTPException(404)
    await sp.delete_line(db, line)
    await db.commit()
    return {"ok": True}
