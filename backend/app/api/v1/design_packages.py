from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, DesignPackage
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["design"])

class DesignIn(BaseModel):
    title: str
    file_key: str | None = None
    notes: str | None = None

def _out(d: DesignPackage) -> dict:
    return {"id": d.id, "title": d.title, "version": d.version, "file_key": d.file_key, "file_url": f"/api/v1/media/{d.file_key}" if d.file_key else None, "notes": d.notes, "status": d.status, "created_at": d.created_at.isoformat()}

@router.get("/{project_id}/design-packages")
async def list_design(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(select(DesignPackage).where(DesignPackage.project_id == project_id).order_by(DesignPackage.version.desc()))
    return [_out(x) for x in r.scalars().all()]

@router.post("/{project_id}/design-packages")
async def create_design(project_id: str, body: DesignIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    mx = await db.execute(select(func.max(DesignPackage.version)).where(DesignPackage.project_id == project_id))
    ver = (mx.scalar() or 0) + 1
    d = DesignPackage(project_id=project_id, title=body.title, version=ver, file_key=body.file_key, notes=body.notes, status="published")
    db.add(d); await db.commit(); await db.refresh(d)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="design", title=f"Дизайн v{ver}: {d.title}", link_path="/design")
    return _out(d)

@router.post("/{project_id}/design-packages/{pkg_id}/submit")
async def submit_design(project_id: str, pkg_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    d = await db.get(DesignPackage, pkg_id)
    if not d or d.project_id != project_id: raise HTTPException(404)
    d.status = "pending"
    await db.commit()
    from app.services import notification_service as ns
    from app.models.entities import Project
    p = await db.get(Project, project_id)
    if p: await ns.notify(db, user_id=p.customer_id, project_id=project_id, notification_type="approval", title="Дизайн на согласовании", body=d.title, link_path="/design")
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"Дизайн v{d.version} на согласовании", link_path="/approvals")
    return _out(d)

@router.post("/{project_id}/design-packages/{pkg_id}/approve")
async def approve_design(project_id: str, pkg_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import UserRole
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer: raise HTTPException(403)
    d = await db.get(DesignPackage, pkg_id)
    if not d or d.project_id != project_id: raise HTTPException(404)
    d.status = "approved"
    await db.commit()
    return _out(d)

@router.post("/{project_id}/design-packages/{pkg_id}/reject")
async def reject_design(project_id: str, pkg_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import UserRole
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer: raise HTTPException(403)
    d = await db.get(DesignPackage, pkg_id)
    if not d or d.project_id != project_id: raise HTTPException(404)
    d.status = "rejected"
    await db.commit()
    return _out(d)

@router.get("/{project_id}/design-packages/diff")
async def design_diff(project_id: str, v1: int = 1, v2: int = 2, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(select(DesignPackage).where(DesignPackage.project_id == project_id))
    items = {x.version: x for x in r.scalars().all()}
    a, b = items.get(v1), items.get(v2)
    if not a or not b: raise HTTPException(404)
    return {"v1": {"title": a.title, "notes": a.notes, "status": a.status}, "v2": {"title": b.title, "notes": b.notes, "status": b.status}, "changed": a.title != b.title or a.notes != b.notes}
