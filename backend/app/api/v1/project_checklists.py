import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project, require_project_dep, require_project_dep
from app.db.session import get_db
from app.models.entities import User, ProjectChecklistTemplate, ChecklistTemplateVersion

router = APIRouter(prefix="/projects", tags=["checklists"])

class TIn(BaseModel):
    name: str
    items: list[str]

@router.get("/{project_id}/checklist-templates")
async def list_tpl(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    r = await db.execute(select(ProjectChecklistTemplate).where(ProjectChecklistTemplate.project_id == project_id))
    return [{"id": t.id, "name": t.name, "items": json.loads(t.items_json)} for t in r.scalars().all()]

@router.post("/{project_id}/checklist-templates")
async def save_tpl(project_id: str, body: TIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep(write=True))):
    t = ProjectChecklistTemplate(project_id=project_id, name=body.name, items_json=json.dumps(body.items, ensure_ascii=False))
    db.add(t); await db.commit(); await db.refresh(t)
    db.add(ChecklistTemplateVersion(template_id=t.id, scope='project', name=body.name, items_json=t.items_json, version=1))
    await db.commit()
    return {"id": t.id, "name": t.name, "items": body.items}

@router.get("/{project_id}/checklist-templates/{tpl_id}/versions")
async def tpl_versions(project_id: str, tpl_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    r = await db.execute(select(ChecklistTemplateVersion).where(ChecklistTemplateVersion.template_id == tpl_id).order_by(ChecklistTemplateVersion.version.desc()))
    return [{"version": v.version, "name": v.name, "items": json.loads(v.items_json), "at": v.created_at.isoformat()} for v in r.scalars().all()]


@router.get("/{project_id}/checklist-templates/{tpl_id}/diff")
async def tpl_diff(project_id: str, tpl_id: str, v1: int = 1, v2: int = 2, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    r = await db.execute(select(ChecklistTemplateVersion).where(ChecklistTemplateVersion.template_id == tpl_id))
    vers = {v.version: json.loads(v.items_json) for v in r.scalars().all()}
    a, b = vers.get(v1, []), vers.get(v2, [])
    return {"added": [x for x in b if x not in a], "removed": [x for x in a if x not in b]}
