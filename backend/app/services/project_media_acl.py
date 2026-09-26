"""Project-scoped media key parsing and ACL enforcement.

New project media is stored under ``project-media/{project_id}/...``. Legacy
``photos/*`` and ``stages/*`` keys are never treated as public: they may be read
only when exactly one persisted project-owned entity references the key and the
current actor can read that project.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    DesignPackage,
    FloorPlan,
    ProjectIssue,
    Stage,
    StagePhoto,
    User,
)
from app.services import project_service as project_svc
from app.services import team_service as team_svc
from app.services.storage_service import normalize_storage_key

PROJECT_MEDIA_PREFIX = "project-media"
LEGACY_PROJECT_MEDIA_PREFIXES = ("photos/", "stages/")
_PROJECT_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    r"|^[0-9a-fA-F]{32}$"
    r"|^[0-9a-zA-Z_-]{8,64}$"
)


@dataclass(frozen=True)
class ProjectMediaKey:
    project_id: str
    relative_path: str


def parse_project_media_key(storage_key: str) -> ProjectMediaKey | None:
    """Parse a canonical ``project-media/{project_id}/...`` storage key."""
    try:
        key = normalize_storage_key(storage_key)
    except Exception:
        return None
    prefix = f"{PROJECT_MEDIA_PREFIX}/"
    if not key.startswith(prefix):
        return None
    rest = key[len(prefix) :]
    if "/" not in rest:
        return None
    project_id, relative = rest.split("/", 1)
    if not project_id or not relative or not _PROJECT_ID_RE.fullmatch(project_id):
        return None
    return ProjectMediaKey(project_id=project_id, relative_path=relative)


def is_legacy_project_media_key(storage_key: str) -> bool:
    try:
        key = normalize_storage_key(storage_key)
    except Exception:
        return False
    return key.startswith(LEGACY_PROJECT_MEDIA_PREFIXES)


async def _require_project_access(
    db: AsyncSession,
    *,
    user: User,
    project_id: str,
    write: bool,
) -> None:
    project = await project_svc.get_project(db, project_id)
    if not project or not await team_svc.can_access_project(db, user, project, write=write):
        raise HTTPException(404, "project_media_not_found")


async def assert_project_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> ProjectMediaKey:
    """Authorize a canonical project-media key using the project encoded in it."""
    parsed = parse_project_media_key(storage_key)
    if parsed is None:
        raise HTTPException(404, "project_media_not_found")
    await _require_project_access(
        db,
        user=user,
        project_id=parsed.project_id,
        write=write,
    )
    return parsed


async def assert_project_media_key_for_project(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    project_id: str,
    write: bool = False,
) -> ProjectMediaKey:
    """Bind a newly attached media key to the mutation's path project.

    New writes intentionally reject legacy unscoped keys. Existing legacy rows are
    read through ``assert_legacy_project_media_access`` below.
    """
    parsed = await assert_project_media_access(db, user, storage_key, write=write)
    if parsed.project_id != project_id:
        raise HTTPException(404, "project_media_not_found")
    return parsed


async def _legacy_reference_project_ids(
    db: AsyncSession,
    storage_key: str,
) -> set[str]:
    """Resolve an old unscoped key through persisted project-owned references."""
    key = normalize_storage_key(storage_key)
    project_ids: set[str] = set()

    stage_ids = (
        await db.execute(
            select(Stage.project_id)
            .join(StagePhoto, StagePhoto.stage_id == Stage.id)
            .where(StagePhoto.storage_key == key)
        )
    ).scalars().all()
    project_ids.update(str(project_id) for project_id in stage_ids if project_id)

    for model, field in (
        (DesignPackage, DesignPackage.file_key),
        (FloorPlan, FloorPlan.image_key),
        (ProjectIssue, ProjectIssue.photo_key),
    ):
        rows = (
            await db.execute(select(model.project_id).where(field == key))
        ).scalars().all()
        project_ids.update(str(project_id) for project_id in rows if project_id)

    return project_ids


async def assert_legacy_project_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> str:
    """Protect legacy project media without inventing a public compatibility path."""
    if not is_legacy_project_media_key(storage_key):
        raise HTTPException(404, "project_media_not_found")
    project_ids = await _legacy_reference_project_ids(db, storage_key)
    if len(project_ids) != 1:
        # Unreferenced or ambiguous legacy bytes fail closed.
        raise HTTPException(404, "project_media_not_found")
    project_id = next(iter(project_ids))
    await _require_project_access(db, user=user, project_id=project_id, write=write)
    return project_id
