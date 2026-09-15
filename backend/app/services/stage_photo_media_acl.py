"""Project-scoped access for stage photo media.

Stage photo URLs are rendered by <Image> and therefore cannot rely on an API
Authorization header. Authorized stage/project reads mint a short-lived HMAC
capability URL. Direct API clients may still use Bearer auth.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Stage, StagePhoto, User
from app.services import project_service as proj_svc
from app.services import team_service as team_svc
from app.services import storage_service as storage_svc

STAGE_PHOTO_TICKET_TTL_SEC = 300
_STAGE_PHOTO_PREFIXES = ("photos/", "stages/")


def is_stage_photo_media_key(storage_key: str) -> bool:
    key = (storage_key or "").lstrip("/")
    return key.startswith(_STAGE_PHOTO_PREFIXES)


def _ticket_signature(storage_key: str, expires: int) -> str:
    key = storage_svc.normalize_storage_key(storage_key)
    payload = f"stage-photo:{key}:{int(expires)}".encode("utf-8")
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()


def issue_stage_photo_ticket(
    storage_key: str,
    *,
    now: int | None = None,
    ttl_sec: int = STAGE_PHOTO_TICKET_TTL_SEC,
) -> tuple[int, str]:
    current = int(time.time() if now is None else now)
    expires = current + max(1, int(ttl_sec))
    return expires, _ticket_signature(storage_key, expires)


def validate_stage_photo_ticket(
    storage_key: str,
    *,
    expires: int,
    signature: str,
    now: int | None = None,
) -> bool:
    current = int(time.time() if now is None else now)
    if int(expires) < current or not signature:
        return False
    expected = _ticket_signature(storage_key, int(expires))
    return hmac.compare_digest(expected, signature)


def stage_photo_media_url(photo: StagePhoto) -> str | None:
    """Return a short-lived URL for stored stage photos, preserving legacy fallback."""
    if not photo.storage_key:
        return photo.image_url
    key = storage_svc.normalize_storage_key(photo.storage_key)
    expires, signature = issue_stage_photo_ticket(key)
    encoded = quote(key, safe="/")
    base = settings.public_base_url.rstrip("/")
    return f"{base}/api/v1/media/{encoded}?expires={expires}&sig={signature}"


async def _project_id_for_key(db: AsyncSession, storage_key: str) -> str | None:
    key = storage_svc.normalize_storage_key(storage_key)
    result = await db.execute(
        select(Stage.project_id)
        .join(StagePhoto, StagePhoto.stage_id == Stage.id)
        .where(StagePhoto.storage_key == key)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def assert_stage_photo_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
) -> str:
    """Authorize a stage-photo key and return project id; foreign keys are privacy-404."""
    project_id = await _project_id_for_key(db, storage_key)
    if not project_id:
        raise HTTPException(404, "stage_photo_not_found")
    project = await proj_svc.get_project(db, project_id)
    if not project:
        raise HTTPException(404, "stage_photo_not_found")

    allowed = await team_svc.can_access_project(db, user, project, write=False)
    if not allowed:
        from app.services import technical_supervision_service as supervision

        allowed = await supervision.is_active_supervisor(
            db,
            project_id=project_id,
            user_id=user.id,
        )
    if not allowed:
        raise HTTPException(404, "stage_photo_not_found")
    return project_id


async def assert_stage_photo_media_ticket(
    db: AsyncSession,
    storage_key: str,
    *,
    expires: int,
    signature: str,
) -> str:
    """Validate a short-lived capability and ensure its photo association still exists."""
    if not validate_stage_photo_ticket(
        storage_key,
        expires=expires,
        signature=signature,
    ):
        raise HTTPException(401, "stage_photo_ticket_invalid_or_expired")
    project_id = await _project_id_for_key(db, storage_key)
    if not project_id:
        raise HTTPException(404, "stage_photo_not_found")
    return project_id
