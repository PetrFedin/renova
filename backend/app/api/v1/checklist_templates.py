from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import json
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, ChecklistTemplate, ChecklistTemplateVersion

router = APIRouter(prefix="/checklist-templates", tags=["checklist"])

class TemplateIn(BaseModel):
    name: str
    items: list[str]

@router.get("")
async def list_templates(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.user_id == user.id))
    return [{"id": t.id, "name": t.name, "items": json.loads(t.items_json)} for t in r.scalars().all()]

@router.post("")
async def save_template(body: TemplateIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = ChecklistTemplate(user_id=user.id, name=body.name, items_json=json.dumps(body.items, ensure_ascii=False))
    db.add(t); await db.commit(); await db.refresh(t)
    db.add(ChecklistTemplateVersion(template_id=t.id, scope='user', name=body.name, items_json=t.items_json, version=1))
    await db.commit()
    return {"id": t.id, "name": t.name, "items": body.items}

@router.get("/{tpl_id}/versions")
async def user_tpl_versions(tpl_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(ChecklistTemplateVersion).where(ChecklistTemplateVersion.template_id == tpl_id).order_by(ChecklistTemplateVersion.version.desc()))
    return [{"version": v.version, "name": v.name, "items": json.loads(v.items_json), "at": v.created_at.isoformat()} for v in r.scalars().all()]
