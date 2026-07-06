"""API endpoints для интеграции с ФНС."""
from datetime import date
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User
from app.services.fns import check_taxpayer_npd_status, FnsNpdError

router = APIRouter(prefix="/fns", tags=["fns"])


class CheckNpdRequest(BaseModel):
    inn: str = Field(..., min_length=12, max_length=12, description="ИНН физлица")
    request_date: date | None = None


class CheckNpdResponse(BaseModel):
    inn: str
    request_date: str
    is_npd: bool
    message: str
    badge: str  # verified | not_npd | error


@router.post("/check-npd", response_model=CheckNpdResponse)
async def check_npd(body: CheckNpdRequest) -> CheckNpdResponse:
    """Проверка самозанятого — для верификации исполнителя и badge в профиле."""
    try:
        result = await check_taxpayer_npd_status(body.inn, body.request_date)
    except FnsNpdError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    badge = "verified" if result["is_npd"] else "not_npd"
    return CheckNpdResponse(**result, badge=badge)


class MoyNalogLinkResponse(BaseModel):
    linked: bool
    message: str


@router.post("/verify-me", response_model=CheckNpdResponse)
async def verify_me(body: CheckNpdRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> CheckNpdResponse:
    """Проверка НПД и сохранение ИНН в профиле исполнителя."""
    try:
        result = await check_taxpayer_npd_status(body.inn, body.request_date)
    except FnsNpdError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    user.inn = body.inn
    user.npd_verified = bool(result.get("is_npd"))
    await db.commit()
    badge = "verified" if result["is_npd"] else "not_npd"
    return CheckNpdResponse(**result, badge=badge)


@router.post("/moy-nalog/link", response_model=MoyNalogLinkResponse)
async def link_moy_nalog(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """v1.1 stub: OAuth «Мой налог» — в production заменить на OAuth ФНС."""
    user.moy_nalog_linked = True
    await db.commit()
    return MoyNalogLinkResponse(linked=True, message="«Мой налог» подключён (demo). Чеки будут создаваться при приёмке этапа.")
