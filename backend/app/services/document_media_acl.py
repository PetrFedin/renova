"""ACL для ключей media под documents/{project_id}/… и project-media/{project_id}/… (Wave 3 / #449).

Зачем:
- Soft ACL (только наличие X-User-Id) не защищает от угадывания UUID проекта.
- Privacy-404 как у Document Center (D-07): чужой проект не раскрываем.
- #449: photos/* (и прочие legacy-ключи вне documents/ и project-media/) минтились
  только после аутентификации, но без привязки к project ACL — IDOR. Теперь legacy-ключ
  разрешается через persisted-ссылку (stage photo / design package / floor plan / issue
  photo) и на нём проверяется ACL того проекта; если ссылки нет — fail closed (404).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    ContractorPortfolioPhoto,
    DesignPackage,
    FloorPlan,
    ProjectIssue,
    Stage,
    StagePhoto,
    User,
)
from app.services import project_service as proj_svc
from app.services import team_service as team_svc

# Project.id — UUID или короткий id из сидов
_PROJECT_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    r"|^[0-9a-fA-F]{32}$"
    r"|^[0-9a-zA-Z_-]{8,64}$"
)

PROJECT_MEDIA_PREFIX = "project-media/"


@dataclass(frozen=True)
class DocumentMediaKey:
    project_id: str
    relative_path: str  # всё после project_id/


def parse_document_media_key(storage_key: str) -> DocumentMediaKey | None:
    """Извлечь project_id из documents/{project_id}/…. Иначе None."""
    key = (storage_key or "").lstrip("/")
    if not key.startswith("documents/"):
        return None
    rest = key[len("documents/") :]
    if not rest or "/" not in rest:
        return None
    project_id, relative = rest.split("/", 1)
    if not project_id or not relative or ".." in relative.split("/"):
        return None
    if not _PROJECT_ID_RE.match(project_id):
        return None
    return DocumentMediaKey(project_id=project_id, relative_path=relative)


async def assert_document_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> DocumentMediaKey:
    """Проверить membership. Чужой / нет проекта → 404 (не 403)."""
    parsed = parse_document_media_key(storage_key)
    if parsed is None:
        raise HTTPException(400, "invalid_document_media_key")
    project = await proj_svc.get_project(db, parsed.project_id)
    if not project:
        raise HTTPException(404, "document_or_project_not_found")
    if not await team_svc.can_access_project(db, user, project, write=write):
        raise HTTPException(404, "document_or_project_not_found")
    return parsed


@dataclass(frozen=True)
class ProjectMediaKey:
    project_id: str
    relative_path: str  # всё после project_id/


def parse_project_media_key(storage_key: str) -> ProjectMediaKey | None:
    """Извлечь project_id из project-media/{project_id}/…. Иначе None."""
    key = (storage_key or "").lstrip("/")
    if not key.startswith(PROJECT_MEDIA_PREFIX):
        return None
    rest = key[len(PROJECT_MEDIA_PREFIX):]
    if not rest or "/" not in rest:
        return None
    project_id, relative = rest.split("/", 1)
    if not project_id or not relative or ".." in relative.split("/"):
        return None
    if not _PROJECT_ID_RE.match(project_id):
        return None
    return ProjectMediaKey(project_id=project_id, relative_path=relative)


def mint_project_media_key(project_id: str, extension: str) -> str:
    """Canonical upload key for project-scoped media (#449)."""
    import uuid as _uuid

    ext = (extension or "jpg").strip().lstrip(".").lower() or "jpg"
    if not re.match(r"^[a-z0-9]{1,8}$", ext):
        ext = "jpg"
    return f"{PROJECT_MEDIA_PREFIX}{project_id}/{_uuid.uuid4().hex}.{ext}"


async def assert_project_media_write_access(
    db: AsyncSession,
    user: User,
    project_id: str,
):
    """Authorize minting a new project-scoped media key. Foreign/missing project → 404."""
    if not project_id or not _PROJECT_ID_RE.match(project_id):
        raise HTTPException(400, "invalid_project_id")
    project = await proj_svc.get_project(db, project_id)
    if not project:
        raise HTTPException(404, "project_not_found")
    if not await team_svc.can_access_project(db, user, project, write=True):
        raise HTTPException(404, "project_not_found")
    return project


async def _resolve_legacy_project_id(db: AsyncSession, storage_key: str) -> str | None:
    """Find which project a pre-#449 (non-namespaced) media key belongs to.

    Looks up every place a raw storage key can be persisted against a project:
    stage photos, floor plan images, design package files, project-issue photos.
    Returns None (fail closed) when the key is not referenced anywhere — an
    unreferenced legacy key must never resolve to "public".
    """
    result = await db.execute(
        select(Stage.project_id)
        .join(StagePhoto, StagePhoto.stage_id == Stage.id)
        .where(StagePhoto.storage_key == storage_key)
        .limit(1)
    )
    project_id = result.scalar_one_or_none()
    if project_id:
        return project_id

    result = await db.execute(
        select(FloorPlan.project_id).where(FloorPlan.image_key == storage_key).limit(1)
    )
    project_id = result.scalar_one_or_none()
    if project_id:
        return project_id

    result = await db.execute(
        select(DesignPackage.project_id).where(DesignPackage.file_key == storage_key).limit(1)
    )
    project_id = result.scalar_one_or_none()
    if project_id:
        return project_id

    result = await db.execute(
        select(ProjectIssue.project_id).where(ProjectIssue.photo_key == storage_key).limit(1)
    )
    project_id = result.scalar_one_or_none()
    if project_id:
        return project_id

    return None


async def _is_open_authenticated_media(db: AsyncSession, storage_key: str) -> bool:
    """Media that is intentionally not project-scoped (e.g. contractor marketplace
    portfolio photos): any authenticated user may view it, no project ACL applies.
    Out of scope for #449 (that's the marketplace domain), but must not be
    swallowed by the new fail-closed default for legacy keys.
    """
    result = await db.execute(
        select(ContractorPortfolioPhoto.id)
        .where(ContractorPortfolioPhoto.image_key == storage_key)
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def assert_project_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> str | None:
    """Resolve + enforce ACL for a project-scoped-or-legacy media key (#449).

    - documents/{project_id}/… → delegate to the existing Wave 3 ACL.
    - project-media/{project_id}/… → canonical scoped key, membership required.
    - anything else (legacy photos/*, issues/*, plans/*, …) → resolve the owning
      project via persisted references; unreferenced/ambiguous keys fail closed (404).

    Returns the resolved project_id, or None if the key carries no project
    binding at all (caller may then apply a non-project policy, if any).
    """
    doc = parse_document_media_key(storage_key)
    if doc is not None:
        await assert_document_media_access(db, user, storage_key, write=write)
        return doc.project_id

    scoped = parse_project_media_key(storage_key)
    project_id = scoped.project_id if scoped is not None else await _resolve_legacy_project_id(db, storage_key)
    if project_id is None:
        if await _is_open_authenticated_media(db, storage_key):
            return None
        # No persisted reference anywhere — fail closed rather than treat as public.
        raise HTTPException(404, "media_not_found")

    project = await proj_svc.get_project(db, project_id)
    if not project:
        raise HTTPException(404, "media_not_found")
    if not await team_svc.can_access_project(db, user, project, write=write):
        raise HTTPException(404, "media_not_found")
    return project_id
