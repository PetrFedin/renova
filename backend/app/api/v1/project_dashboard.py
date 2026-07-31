"""Canonical read-only project dashboard API."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import dashboard_integrity_service as dashboard_svc

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/{project_id}/dashboard")
async def dashboard(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    stages = dashboard_svc.stages_for_user(project, user)
    result = dashboard_svc.build_dashboard_read_model(project, stages=stages)
    role = getattr(getattr(user, "role", None), "value", None) or str(
        getattr(user, "role", "") or ""
    )
    return await dashboard_svc.enrich_dashboard_read_only(
        project_id,
        result,
        role=role,
    )
