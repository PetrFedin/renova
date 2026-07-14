"""Media download / upload-url. Nested document keys supported (Wave 2/3)."""
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse, Response
import mimetypes
import uuid

from app.api.deps import get_current_user
from app.core.config import settings
from app.models.entities import User
from app.services import storage_service as storage_svc

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/upload-url")
async def upload_url(user: User = Depends(get_current_user)):
    key = f"photos/{uuid.uuid4().hex}.jpg"
    url = storage_svc.presigned_put(key)
    pub = f"{settings.public_base_url}/api/v1/media/{key}"
    return {"key": key, "upload_url": url, "public_url": pub}


@router.get("/presign/{file_path:path}")
async def presign_media(file_path: str):
    key = file_path.lstrip("/")
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)


@router.get("/{file_path:path}")
async def get_media(
    file_path: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Serve local/S3 media. Nested keys: documents/{project_id}/file.pdf.

    Wave 3 soft ACL: keys under documents/ require X-User-Id present
    (full project check — next hardening; prevents anonymous scrapes).
    """
    key = file_path.lstrip("/")
    if key.startswith("documents/") and not x_user_id:
        raise HTTPException(401, "Требуется X-User-Id для документов")

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
    cache = "private, max-age=3600" if key.startswith("documents/") else "public, max-age=86400, s-maxage=604800"
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})
