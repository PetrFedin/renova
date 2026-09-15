"""Media download / upload-url with project-scoped private delivery."""
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
from app.services.stage_photo_media_acl import (
    assert_stage_photo_media_access,
    assert_stage_photo_media_ticket,
    is_stage_photo_media_key,
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
    if getattr(user, "deleted_at", None):
        raise HTTPException(401, "account_deleted")
    return user


async def _authorize_private_media(
    db: AsyncSession,
    key: str,
    *,
    authorization: str | None,
    x_user_id: str | None,
    expires: int | None,
    sig: str | None,
) -> None:
    """Authorize known private namespaces before storage lookup or redirect."""
    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
        return

    if is_stage_photo_media_key(key):
        # <Image> cannot reliably attach API Authorization headers. The stage
        # read model therefore emits a short-lived signed media capability.
        if expires is not None and sig:
            await assert_stage_photo_media_ticket(
                db,
                key,
                expires=expires,
                signature=sig,
            )
            return
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_stage_photo_media_access(db, user, key)


@router.post("/upload-url")
async def upload_url(user: User = Depends(get_current_user)):
    # The uploaded object is intentionally unreadable through /media until it
    # is attached to a project-scoped StagePhoto or a valid signed ticket exists.
    key = f"photos/{uuid.uuid4().hex}.jpg"
    url = storage_svc.presigned_put(key)
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": pub}


@router.get("/presign/{file_path:path}")
async def presign_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    expires: int | None = None,
    sig: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Presign redirect after document/stage-photo project ACL."""
    key = file_path.lstrip("/")
    await _authorize_private_media(
        db,
        key,
        authorization=authorization,
        x_user_id=x_user_id,
        expires=expires,
        sig=sig,
    )
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "private, max-age=300"})


@router.get("/{file_path:path}")
async def get_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    expires: int | None = None,
    sig: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Serve media while keeping documents and stage photos project-private.

    documents/{project_id}/… use authenticated project membership.
    photos/* and stages/* must be an attached StagePhoto and use either:
    - Bearer/project membership, or
    - a short-lived HMAC URL minted by an authorized stage read.
    """
    key = file_path.lstrip("/")
    await _authorize_private_media(
        db,
        key,
        authorization=authorization,
        x_user_id=x_user_id,
        expires=expires,
        sig=sig,
    )

    url = storage_svc.presigned_url(key)
    if url:
        return RedirectResponse(
            url,
            status_code=302,
            headers={"Cache-Control": "private, max-age=300" if is_stage_photo_media_key(key) else "private, max-age=3600"},
        )
    data = await storage_svc.read_image(key)
    if not data:
        raise HTTPException(404)
    name = key.rsplit("/", 1)[-1]
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    cache = (
        "private, max-age=300"
        if is_stage_photo_media_key(key)
        else "private, max-age=3600"
        if key.startswith("documents/")
        else "public, max-age=86400, s-maxage=604800"
    )
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
