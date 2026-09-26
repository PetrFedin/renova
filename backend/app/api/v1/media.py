"""Media download / upload-url. Nested document keys + membership ACL (Wave 3)."""
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
import mimetypes
import uuid

from app.api.deps import get_current_user, resolve_user_id
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import storage_service as storage_svc
from app.services.document_media_acl import (
    assert_document_media_access,
    parse_document_media_key,
)
from sqlalchemy import select

router = APIRouter(prefix="/media", tags=["media"])


async def _user_from_auth(
    db: AsyncSession,
    authorization: str | None,
    x_user_id: str | None,
) -> User:
    """Same policy as get_current_user (JWT / optional X-User-Id)."""
    uid = await resolve_user_id(authorization=authorization, x_user_id=x_user_id)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


#: A phone photo at full quality. Above this the client must downscale.
MAX_MEDIA_BYTES = 20 * 1024 * 1024


@router.post("/upload-url")
async def upload_url(user: User = Depends(get_current_user)):
    """Where to put a photo.

    With S3 configured the client PUTs to a presigned URL. Without it there is
    no presigned URL to give — and the key returned here is not a promise that
    anything was stored. The client used to treat it as one: it skipped the PUT
    when `upload_url` was null and returned the key as a success, so the
    reference was saved against a file that did not exist and every later read
    answered 404.

    `direct_upload_url` is the fallback that makes local storage work instead
    of failing silently. It is always present, so a client can always complete
    an upload.
    """
    key = f"photos/{uuid.uuid4().hex}.jpg"
    url = storage_svc.presigned_put(key)
    base = (settings.public_base_url or "").rstrip("/")
    return {
        "key": key,
        "upload_url": url,
        "direct_upload_url": f"{base}/api/v1/media/upload",
        "public_url": f"{base}/api/v1/media/{key}",
    }


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Accept the bytes directly, for deployments without object storage.

    Returns the key the caller must store. Unlike the presigned path, this one
    cannot report success without having written the file.
    """
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty_file")
    if len(data) > MAX_MEDIA_BYTES:
        raise HTTPException(413, "file_too_large")

    content_type = (
        file.content_type
        or mimetypes.guess_type(file.filename or "")[0]
        or "application/octet-stream"
    )
    if not content_type.startswith("image/"):
        raise HTTPException(415, "unsupported_media_type")

    key, href = await storage_svc.save_bytes(
        data,
        folder="photos",
        filename=file.filename or "photo.jpg",
        content_type=content_type,
    )
    return {"key": key, "public_url": href}


@router.get("/presign/{file_path:path}")
async def presign_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Presign redirect. documents/* — membership ACL; photos — без ACL (как раньше)."""
    key = file_path.lstrip("/")
    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
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
    """Serve local/S3 media.

    Wave 3 ACL for documents/{project_id}/…:
    - no auth → 401 (Bearer JWT; X-User-Id only if allow_header_user_id)
    - no membership → 404 (privacy)
    photos/* remain without project ACL (upload-url already requires auth).
    """
    key = file_path.lstrip("/")
    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
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
