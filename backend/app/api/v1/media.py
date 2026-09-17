"""Media download / upload-url. Nested document keys + membership ACL (Wave 3)."""
from fastapi import APIRouter, Depends, Header, HTTPException
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


@router.post("/upload-url")
async def upload_url(user: User = Depends(get_current_user)):
    key = f"photos/{uuid.uuid4().hex}.jpg"
    url = storage_svc.presigned_put(key)
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": pub}


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
    # Every object served here is private project content: stage photos,
    # quality-control defect shots, floor plans, receipt scans. `photos/*` used
    # to be returned as `public, s-maxage=604800`, which invites any shared
    # cache — CDN, corporate proxy — to retain one customer's renovation photos
    # for a week and hand them to whoever asks for the same URL.
    #
    # `private` keeps client-side caching (React Native <Image> still caches
    # locally, so nothing gets slower for the user) while removing the shared
    # copy. It does not fix the underlying gap: `photos/*` carries no project in
    # its key (`photos/{uuid}.jpg`), so possession of the URL is still the only
    # authorisation, and those URLs never expire. Closing that needs a
    # project-scoped key scheme plus expiring signatures and a migration for
    # already-stored URLs — tracked as #449, not something to half-do here.
    cache = "private, max-age=3600" if key.startswith("documents/") else "private, max-age=86400"
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
