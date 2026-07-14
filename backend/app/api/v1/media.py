"""Media download / upload-url. Nested document keys + membership ACL (Wave 3)."""
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import mimetypes
import uuid

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import storage_service as storage_svc
from app.services.document_media_acl import (
    assert_document_media_access,
    parse_document_media_key,
)

router = APIRouter(prefix="/media", tags=["media"])


async def _resolve_user(db: AsyncSession, x_user_id: str | None) -> User:
    if not x_user_id:
        raise HTTPException(401, "Требуется X-User-Id для документов")
    result = await db.execute(select(User).where(User.id == x_user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


@router.post("/upload-url")
async def upload_url(user: User = Depends(get_current_user)):
    key = f"photos/{uuid.uuid4().hex}.jpg"
    url = storage_svc.presigned_put(key)
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": pub}


@router.get("/presign/{file_path:path}")
async def presign_media(
    file_path: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Presign redirect. documents/* — membership; photos — без ACL (как раньше)."""
    key = file_path.lstrip("/")
    if parse_document_media_key(key) is not None:
        user = await _resolve_user(db, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)


@router.get("/{file_path:path}")
async def get_media(
    file_path: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Serve local/S3 media.

    Wave 3 ACL для documents/{project_id}/…:
    - нет X-User-Id → 401
    - нет membership → 404 (privacy, как Document Center)
    photos/* остаются без project ACL (upload-url уже требует auth).
    """
    key = file_path.lstrip("/")
    if parse_document_media_key(key) is not None:
        user = await _resolve_user(db, x_user_id)
        await assert_document_media_access(db, user, key, write=False)

    url = storage_svc.presigned_url(key)
    if url:
        return RedirectResponse(
            url,
            status_code=302,
            headers={"Cache-Control": "private, max-age=3600"},
        )
    data = await storage_svc.read_image(key)
    if not data:
        raise HTTPException(404)
    name = key.rsplit("/", 1)[-1]
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    cache = (
        "private, max-age=3600"
        if key.startswith("documents/")
        else "public, max-age=86400, s-maxage=604800"
    )
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
