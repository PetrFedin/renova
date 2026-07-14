"""E-sign providers catalog (Wave 3b)."""
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.entities import User
from app.services.esign import list_providers

router = APIRouter(prefix="/esign", tags=["esign"])


@router.get("/providers")
async def esign_providers(_user: User = Depends(get_current_user)):
    """Список провайдеров подписи: available=false → UI не предлагает / API 501 на sign."""
    return {"providers": list_providers()}
