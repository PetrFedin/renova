"""Fail-closed ACL and short-lived delivery capabilities for project media.

Project media historically used opaque ``photos/<uuid>`` keys. Opaque names are not
an authorization boundary. This module resolves those legacy keys through their
canonical owning entities and also understands the new ``projects/<project_id>/...``
namespace. Unattached/unknown keys are not readable through the application media
endpoint.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import time
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import (
    ContractorPortfolioPhoto,
    ContractorProfile,
    DesignPackage,
    FloorPlan,
    Project,
    ProjectIssue,
    Stage,
    StagePhoto,
    User,
)
from app.services import storage_service as storage_svc
from app.services import team_service as team_svc

_CAPABILITY_VERSION = "project-media-v1"
_DEFAULT_CAPABILITY_TTL_SECONDS = 300


@dataclass(frozen=True)
class ProjectMediaBinding:
    project_id: str
    stage_id: str | None = None


def _privacy_404() -> HTTPException:
    return HTTPException(404, "media_or_project_not_found")


def parse_project_media_key(storage_key: str) -> ProjectMediaBinding | None:
    """Parse canonical ``projects/<project_id>/...`` media keys."""
    try:
        key = storage_svc.normalize_storage_key(storage_key)
    except storage_svc.InvalidStorageKey:
        return None
    parts = key.split("/")
    if len(parts) < 3 or parts[0] != "projects" or not parts[1]:
        return None
    project_id = parts[1]
    stage_id = None
    if len(parts) >= 5 and parts[2] == "stages" and parts[3]:
        stage_id = parts[3]
    return ProjectMediaBinding(project_id=project_id, stage_id=stage_id)


async def _legacy_project_bindings(
    db: AsyncSession,
    storage_key: str,
) -> list[ProjectMediaBinding]:
    """Resolve pre-project-namespace keys through authoritative entity rows."""
    key = storage_svc.normalize_storage_key(storage_key)
    bindings: list[ProjectMediaBinding] = []

    stage_rows = (
        await db.execute(
            select(Stage.project_id, Stage.id)
            .join(StagePhoto, StagePhoto.stage_id == Stage.id)
            .where(StagePhoto.storage_key == key)
        )
    ).all()
    bindings.extend(ProjectMediaBinding(project_id=row[0], stage_id=row[1]) for row in stage_rows)

    design_project_ids = (
        await db.execute(select(DesignPackage.project_id).where(DesignPackage.file_key == key))
    ).scalars().all()
    bindings.extend(ProjectMediaBinding(project_id=project_id) for project_id in design_project_ids)

    floor_project_ids = (
        await db.execute(select(FloorPlan.project_id).where(FloorPlan.image_key == key))
    ).scalars().all()
    bindings.extend(ProjectMediaBinding(project_id=project_id) for project_id in floor_project_ids)

    issue_project_ids = (
        await db.execute(select(ProjectIssue.project_id).where(ProjectIssue.photo_key == key))
    ).scalars().all()
    bindings.extend(ProjectMediaBinding(project_id=project_id) for project_id in issue_project_ids)
    return bindings


async def resolve_project_media_binding(
    db: AsyncSession,
    storage_key: str,
) -> ProjectMediaBinding | None:
    """Return one unambiguous project binding or fail closed for conflicting reuse."""
    parsed = parse_project_media_key(storage_key)
    if parsed is not None:
        return parsed

    bindings = await _legacy_project_bindings(db, storage_key)
    if not bindings:
        return None
    project_ids = {binding.project_id for binding in bindings}
    if len(project_ids) != 1:
        raise _privacy_404()
    stage_ids = {binding.stage_id for binding in bindings if binding.stage_id is not None}
    stage_id = next(iter(stage_ids)) if len(stage_ids) == 1 else None
    return ProjectMediaBinding(project_id=next(iter(project_ids)), stage_id=stage_id)


async def is_public_portfolio_media(db: AsyncSession, storage_key: str) -> bool:
    """Portfolio media is the only intentionally public non-project media class."""
    key = storage_svc.normalize_storage_key(storage_key)
    visible = await db.scalar(
        select(ContractorPortfolioPhoto.id)
        .join(ContractorProfile, ContractorProfile.id == ContractorPortfolioPhoto.profile_id)
        .where(
            ContractorPortfolioPhoto.image_key == key,
            ContractorProfile.visible.is_(True),
        )
        .limit(1)
    )
    return visible is not None


async def assert_project_media_target_access(
    db: AsyncSession,
    user: User,
    *,
    project_id: str,
    stage_id: str | None = None,
    write: bool = False,
) -> ProjectMediaBinding:
    """Check project membership and resource binding, returning privacy 404 on denial."""
    project = await db.get(Project, project_id)
    if not project or getattr(project, "trashed_at", None):
        raise _privacy_404()

    allowed = await team_svc.can_access_project(db, user, project, write=write)
    if not allowed and not write:
        from app.services import technical_supervision_service as supervision

        allowed = await supervision.is_active_supervisor(
            db,
            project_id=project.id,
            user_id=user.id,
        )
    if not allowed:
        raise _privacy_404()

    if stage_id is not None:
        stage = await db.get(Stage, stage_id)
        if not stage or stage.project_id != project_id:
            raise _privacy_404()
    return ProjectMediaBinding(project_id=project_id, stage_id=stage_id)


async def assert_project_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> ProjectMediaBinding:
    binding = await resolve_project_media_binding(db, storage_key)
    if binding is None:
        raise _privacy_404()
    return await assert_project_media_target_access(
        db,
        user,
        project_id=binding.project_id,
        stage_id=binding.stage_id,
        write=write,
    )


def _capability_signature(storage_key: str, expires_at: int) -> str:
    key = storage_svc.normalize_storage_key(storage_key)
    payload = f"{_CAPABILITY_VERSION}\n{key}\n{expires_at}".encode("utf-8")
    return hmac.new(settings.secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def signed_media_path(
    storage_key: str,
    *,
    ttl_seconds: int = _DEFAULT_CAPABILITY_TTL_SECONDS,
) -> str:
    """Create a short-lived bearer capability after the caller has passed resource ACL."""
    key = storage_svc.normalize_storage_key(storage_key)
    ttl = max(30, min(int(ttl_seconds), 900))
    expires_at = int(time.time()) + ttl
    signature = _capability_signature(key, expires_at)
    encoded_key = quote(key, safe="/")
    return f"/api/v1/media/{encoded_key}?exp={expires_at}&sig={signature}"


def verify_media_capability(
    storage_key: str,
    *,
    expires_at: int | None,
    signature: str | None,
) -> bool:
    if expires_at is None or not signature:
        return False
    now = int(time.time())
    if expires_at < now or expires_at > now + 900:
        return False
    try:
        expected = _capability_signature(storage_key, expires_at)
    except storage_svc.InvalidStorageKey:
        return False
    return hmac.compare_digest(expected, signature)
