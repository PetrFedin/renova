"""Media download / upload-url. Project-scoped ACL for all project media (#449)."""
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
import mimetypes

from app.api.deps import get_current_user, resolve_user_id
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import storage_service as storage_svc
from app.services.document_media_acl import (
    assert_project_media_access,
    assert_project_media_write_access,
    mint_project_media_key,
    parse_document_media_key,
    parse_project_media_key,
)
from app.services.chat_media_acl import assert_chat_media_access, is_chat_media_key
from sqlalchemy import select

router = APIRouter(prefix="/media", tags=["media"])

# content-type → extension for upload-url minting. Falls back to jpg (previous
# universal behaviour) for anything unrecognized; PDFs keep their real
# extension instead of being forced to .jpg (#449 acceptance #7).
_UPLOAD_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/gif": "gif",
    "application/pdf": "pdf",
}


async def _user_from_auth(
    request: Request,
    db: AsyncSession,
    authorization: str | None,
    x_user_id: str | None,
) -> User:
    """Same policy as get_current_user (JWT / optional X-User-Id)."""
    uid = await resolve_user_id(request=request, authorization=authorization, x_user_id=x_user_id)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


_UPLOAD_TOKEN_TTL = 900
_MAX_LOCAL_UPLOAD_BYTES = 25 * 1024 * 1024


def _mint_upload_token(key: str, *, expires_at: int | None = None) -> str:
    import hashlib
    import hmac
    import time

    exp = expires_at if expires_at is not None else int(time.time()) + _UPLOAD_TOKEN_TTL
    mac = hmac.new(settings.secret_key.encode(), f"media-upload:{key}:{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{mac}"


def _upload_token_valid(key: str, token: str | None) -> bool:
    import hmac
    import time

    try:
        exp_raw, _ = (token or "").split(".", 1)
        exp = int(exp_raw)
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    return hmac.compare_digest(_mint_upload_token(key, expires_at=exp), token or "")


@router.put("/{file_path:path}")
async def put_local_media(
    request: Request,
    file_path: str,
    upload_token: str | None = Query(default=None),
):
    """Локальная загрузка байтов по ключу, выданному `/media/upload-url` (DOC-011).

    Работает только без S3 и только для project-media ключей с валидным токеном.
    """
    key = file_path.lstrip("/")
    if storage_svc.presigned_put(key) is not None:
        raise HTTPException(404)
    if parse_project_media_key(key) is None or not _upload_token_valid(key, upload_token):
        raise HTTPException(403, "invalid_upload_token")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > _MAX_LOCAL_UPLOAD_BYTES:
        raise HTTPException(413, "file_too_large")
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty_file_payload")
    if len(data) > _MAX_LOCAL_UPLOAD_BYTES:
        raise HTTPException(413, "file_too_large")
    await storage_svc.write_bytes_at_key(key, data, content_type=request.headers.get("content-type") or "application/octet-stream")
    return Response(status_code=200)


@router.post("/upload-url")
async def upload_url(
    project_id: str = Query(...),
    content_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a project-scoped upload key (#449).

    Requires current write authority on `project_id` — an unrelated account
    gets 404 before any key is minted, so uploaded bytes can never end up
    bound to a project the caller doesn't control.
    """
    await assert_project_media_write_access(db, user, project_id)
    normalized_content_type = (content_type or "").strip().lower()
    extension = _UPLOAD_EXTENSIONS.get(normalized_content_type, "jpg")
    key = mint_project_media_key(project_id, extension)
    url = storage_svc.presigned_put(key, content_type=normalized_content_type or "image/jpeg")
    if url is None:
        # Локальный режим (DOC-011): S3 нет, но загрузка должна работать, а не
        # молча оставлять ключ без файла. Ссылка ведёт на PUT этого же API с
        # короткоживущим токеном, привязанным к ключу (клиент грузит без Bearer).
        url = f"{settings.public_base_url.rstrip('/')}/api/v1/media/{key}?upload_token={_mint_upload_token(key)}"
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": pub}


@router.get("/presign/{file_path:path}")
async def presign_media(
    request: Request,
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Presign redirect. documents/* и chat-media/*|chat/* — membership/thread ACL;
    everything else (project-media/*, legacy photos/*|issues/*|plans/*|…) —
    project ACL via assert_project_media_access (#449): unrelated account → 404.
    """
    key = file_path.lstrip("/")
    user = await _user_from_auth(request, db, authorization, x_user_id)
    if parse_document_media_key(key) is not None:
        await assert_project_media_access(db, user, key, write=False)
    elif is_chat_media_key(key):
        await assert_chat_media_access(db, user, key, write=False)
    else:
        await assert_project_media_access(db, user, key, write=False)
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)


@router.get("/{file_path:path}")
async def get_media(
    request: Request,
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Serve local/S3 media.

    Every key now requires authentication and a project (or chat-thread, or
    explicitly-open) authority check (#449):
    - no auth → 401 (Bearer JWT; X-User-Id only if allow_header_user_id)
    - no membership / unreferenced legacy key → 404 (privacy, fail closed)
    documents/{project_id}/… → Wave 3 project ACL.
    chat-media/{thread_id}/… and legacy chat/* (#453) → chat thread authority.
    project-media/{project_id}/… (#449 canonical) and any other legacy key
    (photos/*, issues/*, plans/*, …) → resolved project ACL, or the narrow
    explicitly-open allowlist (e.g. contractor marketplace portfolio photos)
    for media that was never project-scoped to begin with.
    """
    key = file_path.lstrip("/")
    user = await _user_from_auth(request, db, authorization, x_user_id)
    if parse_document_media_key(key) is not None:
        await assert_project_media_access(db, user, key, write=False)
    elif is_chat_media_key(key):
        await assert_chat_media_access(db, user, key, write=False)
    else:
        await assert_project_media_access(db, user, key, write=False)

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
        if key.startswith("documents/") or is_chat_media_key(key)
        else "public, max-age=86400, s-maxage=604800"
    )
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
