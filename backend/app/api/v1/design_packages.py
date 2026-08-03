from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import DesignPackage, Project, User
from app.services import design_package_service as design_svc

router = APIRouter(prefix="/projects", tags=["design"])


class DesignIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    file_key: str | None = Field(default=None, max_length=512)
    notes: str | None = Field(default=None, max_length=4000)


def _out(package: DesignPackage, *, replayed: bool | None = None) -> dict:
    result = {
        "id": package.id,
        "title": package.title,
        "version": package.version,
        "file_key": package.file_key,
        "file_url": f"/api/v1/media/{package.file_key}" if package.file_key else None,
        "notes": package.notes,
        "status": package.status,
        "created_at": package.created_at.isoformat(),
    }
    if replayed is not None:
        result["replayed"] = replayed
    return result


def _design_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code == "design_decision_actor_forbidden":
        return HTTPException(
            403,
            detail={"code": code, "message": "Действие доступно только назначенному участнику проекта"},
        )
    if code.startswith("invalid_design_transition:"):
        return HTTPException(
            409,
            detail={"code": "invalid_design_transition", "transition": code.split(":", 1)[1]},
        )
    if code in {"design_title_invalid", "design_file_key_invalid"}:
        return HTTPException(422, detail={"code": code})
    return HTTPException(409, detail={"code": code})


@router.get("/{project_id}/design-packages")
async def list_design(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    result = await db.execute(
        select(DesignPackage)
        .where(DesignPackage.project_id == project_id)
        .order_by(DesignPackage.version.desc())
    )
    return [_out(package) for package in result.scalars().all()]


@router.post("/{project_id}/design-packages")
async def create_design(
    project_id: str,
    body: DesignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project: Project = await require_project(db, project_id, user, write=True)
    try:
        package = await design_svc.create_package(
            db,
            project=project,
            actor=user,
            title=body.title,
            file_key=body.file_key,
            notes=body.notes,
        )
    except ValueError as error:
        raise _design_error(error) from error
    return _out(package, replayed=False)


async def _transition(
    *,
    project_id: str,
    package_id: str,
    action: design_svc.DesignAction,
    user: User,
    db: AsyncSession,
) -> dict:
    project: Project = await require_project(db, project_id, user, write=True)
    try:
        package, replayed = await design_svc.transition_package(
            db,
            project=project,
            package_id=package_id,
            actor=user,
            action=action,
        )
    except ValueError as error:
        raise _design_error(error) from error
    if package is None:
        raise HTTPException(404, detail={"code": "design_package_not_found"})
    return _out(package, replayed=replayed)


@router.post("/{project_id}/design-packages/{pkg_id}/submit")
async def submit_design(
    project_id: str,
    pkg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        package_id=pkg_id,
        action="submit",
        user=user,
        db=db,
    )


@router.post("/{project_id}/design-packages/{pkg_id}/approve")
async def approve_design(
    project_id: str,
    pkg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        package_id=pkg_id,
        action="approve",
        user=user,
        db=db,
    )


@router.post("/{project_id}/design-packages/{pkg_id}/reject")
async def reject_design(
    project_id: str,
    pkg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        package_id=pkg_id,
        action="reject",
        user=user,
        db=db,
    )


@router.get("/{project_id}/design-packages/diff")
async def design_diff(
    project_id: str,
    v1: int = 1,
    v2: int = 2,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    result = await db.execute(
        select(DesignPackage).where(DesignPackage.project_id == project_id)
    )
    items = {package.version: package for package in result.scalars().all()}
    first, second = items.get(v1), items.get(v2)
    if not first or not second:
        raise HTTPException(404)
    return {
        "v1": {"title": first.title, "notes": first.notes, "status": first.status},
        "v2": {"title": second.title, "notes": second.notes, "status": second.status},
        "changed": first.title != second.title or first.notes != second.notes,
    }
