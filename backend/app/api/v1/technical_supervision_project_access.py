from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.api.v1 import projects as projects_api
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project import ProjectDetail, ProjectOut
from app.services import dashboard_integrity_service as dashboard_svc
from app.services import project_service as project_svc
from app.services import technical_supervision_service as supervision

router = APIRouter(prefix="/projects", tags=["projects"])


class TechnicalProjectOut(ProjectOut):
    technical_capabilities: list[str] = Field(default_factory=list)


class TechnicalProjectDetail(ProjectDetail):
    technical_capabilities: list[str] = Field(default_factory=list)


async def _summary_for_user(
    db: AsyncSession, *, user: User, project
) -> TechnicalProjectOut:
    mode, _read_only, capabilities = await supervision.project_access_descriptor(
        db, user=user, project=project
    )
    return TechnicalProjectOut(
        **projects_api._project_out(project, access_mode=mode).model_dump(),
        technical_capabilities=capabilities,
    )


@router.get("", response_model=list[TechnicalProjectOut])
async def list_projects(
    bucket: str = "active",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if bucket not in ("active", "archived", "trashed"):
        bucket = "active"
    base = await project_svc.list_projects_for_user(db, user, bucket=bucket)
    supervised = await supervision.list_supervised_projects(
        db, user_id=user.id, bucket=bucket
    )
    merged = list(base)
    seen = {project.id for project in merged}
    for project in supervised:
        if project.id not in seen:
            merged.append(project)
            seen.add(project.id)
    merged.sort(key=lambda project: project.created_at, reverse=True)
    return [await _summary_for_user(db, user=user, project=project) for project in merged]


@router.get("/{project_id}", response_model=TechnicalProjectDetail)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    mode, read_only, capabilities = await supervision.project_access_descriptor(
        db, user=user, project=project
    )
    if mode == "supervisor":
        # The global account may be a contractor, but independent QC must see the
        # entire object rather than contractor-assigned stage filtering.
        detail = await projects_api._detail(db, project, None)
    else:
        detail = await projects_api._detail(db, project, user)
    return TechnicalProjectDetail(
        **detail.model_dump(exclude={"access_mode", "read_only"}),
        access_mode=mode,
        read_only=read_only,
        technical_capabilities=capabilities,
    )


@router.get("/{project_id}/dashboard")
async def dashboard(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    mode, _read_only, _capabilities = await supervision.project_access_descriptor(
        db, user=user, project=project
    )
    stages = (
        sorted(project.stages or [], key=lambda stage: stage.sort_order)
        if mode == "supervisor"
        else dashboard_svc.stages_for_user(project, user)
    )
    result = dashboard_svc.build_dashboard_read_model(project, stages=stages)
    role = (
        "supervisor"
        if mode == "supervisor"
        else (
            getattr(getattr(user, "role", None), "value", None)
            or str(getattr(user, "role", "") or "")
        )
    )
    return await dashboard_svc.enrich_dashboard_read_only(
        project_id, result, role=role
    )
