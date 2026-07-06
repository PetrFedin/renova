from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response
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

@router.get("/presign/{folder}/{filename}")
async def presign_media(folder: str, filename: str):
    key = f"{folder}/{filename}"
    url = storage_svc.presigned_url(key)
    if not url:
        raise HTTPException(404)
    return RedirectResponse(url, status_code=302)

@router.get("/{folder}/{filename}")
async def get_media(folder: str, filename: str):
    key = f"{folder}/{filename}"
    url = storage_svc.presigned_url(key)
    if url:
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "public, max-age=86400, s-maxage=604800"})
    data = await storage_svc.read_image(key)
    if not data:
        raise HTTPException(404)
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400, s-maxage=604800"})
