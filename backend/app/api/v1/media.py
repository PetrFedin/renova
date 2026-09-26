"""Authenticated media download and project-scoped upload intents."""
from __future__ import annotations

import mimetypes
import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project, resolve_user_id
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import storage_service as storage_svc
from app.services.document_media_acl import (
    assert_document_media_access,
    parse_document_media_key,
)
from app.services.project_media_acl import (
    assert_legacy_project_media_access,
    assert_project_media_access,
    is_legacy_project_media_key,
    parse_project_media_key,
)

router = APIRouter(prefix="/media", tags=["media"])
_SAFE_SUFFIX_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


class UploadUrlIn(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    content_type: str = Field(default="image/jpeg", min_length=1, max_length=128)
    filename: str | None = Field(default=None, max_length=255)


async def _user_from_auth(
    db: AsyncSession,
    authorization: str | None,
    x_user_id: str | None,
) -> User:
    """Same identity policy as get_current_user (JWT / optional test header)."""
    uid = await resolve_user_id(authorization=authorization, x_user_id=x_user_id)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


def _upload_suffix(content_type: str, filename: str | None) -> str:
    if filename:
        cleaned = filename.replace("\\", "/").rsplit("/", 1)[-1]
        dot = cleaned.rfind(".")
        if dot >= 0:
            suffix = cleaned[dot:].lower()
            if _SAFE_SUFFIX_RE.fullmatch(suffix):
                return suffix
    normalized = content_type.split(";", 1)[0].strip().lower()
    explicit = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
    }
    guessed = explicit.get(normalized) or mimetypes.guess_extension(normalized) or ".bin"
    return guessed if _SAFE_SUFFIX_RE.fullmatch(guessed) else ".bin"


def _presigned_put(key: str, content_type: str) -> str | None:
    """Presign the exact Content-Type sent by the mobile producer.

    ``storage_service.presigned_put`` predates document uploads and signs every PUT
    as image/jpeg. Keep that legacy helper untouched for unrelated callers while
    this project-scoped endpoint preserves the real MIME contract.
    """
    normalized = storage_svc.normalize_storage_key(key)
    client = storage_svc._s3_client()  # storage configuration remains centralized
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": normalized,
                "ContentType": content_type,
            },
            ExpiresIn=900,
        )
    except Exception as exc:
        raise storage_svc.StorageUnavailable("s3_presign_failed") from exc


@router.post("/upload-url")
async def upload_url(
    body: UploadUrlIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a write-authorized, project-bound media key.

    The project id is encoded into the storage key, so later GET/presign and
    attachment operations can prove ownership without trusting caller metadata.
    """
    await require_project(db, body.project_id, user, write=True)
    content_type = body.content_type.split(";", 1)[0].strip().lower()
    suffix = _upload_suffix(content_type, body.filename)
    key = storage_svc.normalize_storage_key(
        f"project-media/{body.project_id}/{uuid.uuid4().hex}{suffix}"
    )
    url = _presigned_put(key, content_type)
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {
        "key": key,
        "upload_url": url,
        "public_url": pub,
        "content_type": content_type,
    }


async def _authorize_media_read(
    db: AsyncSession,
    *,
    key: str,
    authorization: str | None,
    x_user_id: str | None,
) -> bool:
    """Return whether this key is project-private and enforce its read ACL."""
    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
        return True
    if parse_project_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_project_media_access(db, user, key, write=False)
        return True
    if is_legacy_project_media_key(key):
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_legacy_project_media_access(db, user, key, write=False)
        return True
    return False


@router.get("/presign/{file_path:path}")
async def presign_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    key = storage_svc.normalize_storage_key(file_path.lstrip("/"))
    await _authorize_media_read(
        db,
        key=key,
        authorization=authorization,
        x_user_id=x_user_id,
    )
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)


@router.get("/{file_path:path}")
async def get_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Serve media after the owning namespace's ACL has been enforced."""
    key = storage_svc.normalize_storage_key(file_path.lstrip("/"))
    private = await _authorize_media_read(
        db,
        key=key,
        authorization=authorization,
        x_user_id=x_user_id,
    )

    url = storage_svc.presigned_url(key)
    if url:
        return RedirectResponse(
            url,
            status_code=302,
            headers={"Cache-Control": "private, max-age=3600" if private else "public, max-age=86400"},
        )
    data = await storage_svc.read_image(key)
    if not data:
        raise HTTPException(404)
    name = key.rsplit("/", 1)[-1]
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    cache = (
        "private, max-age=3600"
        if private
        else "public, max-age=86400, s-maxage=604800"
    )
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
