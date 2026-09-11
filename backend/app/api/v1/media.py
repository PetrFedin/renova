"""Media delivery with fail-closed project/document ACLs."""
import mimetypes
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, resolve_user_id
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import storage_service as storage_svc
from app.services.document_media_acl import (
    assert_document_media_access,
    parse_document_media_key,
)
from app.services.project_media_acl import (
    assert_project_media_access,
    assert_project_media_target_access,
    is_public_portfolio_media,
    resolve_project_media_binding,
    signed_media_path,
    verify_media_capability,
)

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


def _canonical_key(file_path: str) -> str:
    try:
        return storage_svc.normalize_storage_key(file_path.lstrip("/"))
    except storage_svc.InvalidStorageKey as exc:
        raise HTTPException(404, "media_not_found") from exc


def _media_404() -> HTTPException:
    return HTTPException(404, "media_or_project_not_found")


@router.post("/upload-url")
async def upload_url(
    project_id: str | None = None,
    stage_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Issue a PUT target.

    New callers should pass ``project_id`` (and ``stage_id`` for stage photos), which
    produces a canonical project-bound key. Existing callers remain safe while they
    migrate: their temporary ``uploads/<user>/...`` key is unreadable until a
    project entity binds it, after which GET/presign resolves the owning project.
    """
    if stage_id and not project_id:
        raise HTTPException(422, "project_id_required_for_stage_media")

    if project_id:
        await assert_project_media_target_access(
            db,
            user,
            project_id=project_id,
            stage_id=stage_id,
            write=True,
        )
        if stage_id:
            key = f"projects/{project_id}/stages/{stage_id}/photos/{uuid.uuid4().hex}.jpg"
        else:
            key = f"projects/{project_id}/uploads/{uuid.uuid4().hex}.jpg"
    else:
        key = f"uploads/{user.id}/{uuid.uuid4().hex}.jpg"

    url = storage_svc.presigned_put(key)
    public_url = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": public_url}


async def _authorize_non_document_media(
    db: AsyncSession,
    *,
    user: User | None,
    key: str,
    expires_at: int | None = None,
    signature: str | None = None,
) -> bool:
    """Authorize project media; return True only for intentionally public portfolio media.

    Project ownership always wins over a public-media association. A project blob
    cannot become public merely because the same key is later referenced by a
    contractor portfolio row.
    """
    if verify_media_capability(key, expires_at=expires_at, signature=signature):
        return False

    project_binding = await resolve_project_media_binding(db, key)
    if project_binding is not None:
        if user is None:
            raise HTTPException(401, "Требуется Authorization")
        await assert_project_media_access(db, user, key, write=False)
        return False

    if await is_public_portfolio_media(db, key):
        return True

    if user is None:
        raise HTTPException(401, "Требуется Authorization")
    raise _media_404()


@router.get("/capability/{file_path:path}")
async def project_media_capability(
    file_path: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a five-minute image/file URL only after current project ACL succeeds."""
    key = _canonical_key(file_path)
    if parse_document_media_key(key) is not None:
        raise HTTPException(400, "document_media_uses_document_delivery_contract")

    project_binding = await resolve_project_media_binding(db, key)
    if project_binding is not None:
        await assert_project_media_access(db, user, key, write=False)
    elif not await is_public_portfolio_media(db, key):
        raise _media_404()

    path = signed_media_path(key)
    return {"url": f"{settings.public_base_url.rstrip('/')}{path}"}


@router.get("/presign/{file_path:path}")
async def presign_media(
    file_path: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Return an S3/MinIO redirect only after the canonical media ACL succeeds."""
    key = _canonical_key(file_path)
    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
    else:
        user = None
        if authorization or x_user_id:
            user = await _user_from_auth(db, authorization, x_user_id)
        await _authorize_non_document_media(db, user=user, key=key)

    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)


@router.get("/{file_path:path}")
async def get_media(
    file_path: str,
    exp: int | None = None,
    sig: str | None = None,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Serve private project media, private documents, or public portfolio media.

    Project media is never authorized by an opaque filename. It requires current
    project membership or a short-lived capability minted by an already-authorized
    project read. Foreign access is privacy-404. Visible contractor portfolio media
    remains intentionally public only when the key is not also project-bound.
    """
    key = _canonical_key(file_path)
    public_portfolio = False

    if parse_document_media_key(key) is not None:
        user = await _user_from_auth(db, authorization, x_user_id)
        await assert_document_media_access(db, user, key, write=False)
    else:
        user = None
        if authorization or x_user_id:
            user = await _user_from_auth(db, authorization, x_user_id)
        public_portfolio = await _authorize_non_document_media(
            db,
            user=user,
            key=key,
            expires_at=exp,
            signature=sig,
        )

    url = storage_svc.presigned_url(key)
    if url:
        return RedirectResponse(
            url,
            status_code=302,
            headers={"Cache-Control": "public, max-age=3600" if public_portfolio else "private, max-age=300"},
        )

    data = await storage_svc.read_image(key)
    if not data:
        raise HTTPException(404)
    name = key.rsplit("/", 1)[-1]
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    cache = "public, max-age=86400, s-maxage=604800" if public_portfolio else "private, max-age=300"
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
