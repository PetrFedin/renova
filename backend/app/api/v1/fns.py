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


@router.get("/health")
async def fns_health(_user: User = Depends(get_current_user)):
    """P4: staging probe ФНС чеки / НПД (без секретов)."""
    from app.services.fns.receipt_verify import fns_receipt_health
    _ = _user
    return fns_receipt_health()



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
    mode: str = "enabled"  # demo | enabled — never implies real OAuth yet
    status: str = "not_connected"


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
    """OAuth «Мой налог»: demo только development/test или MOY_NALOG_ENABLED."""
    from app.core.config import settings
    from app.core.environment import normalize_environment

    env = normalize_environment(settings.environment)
    demo_ok = env in ("development", "test")
    if not settings.moy_nalog_enabled and not demo_ok:
        raise HTTPException(
            501,
            "«Мой налог» OAuth ещё не подключён. Задайте MOY_NALOG_ENABLED=true после интеграции или используйте demo в development.",
        )
    # Не OAuth: статус admin_enabled / demo — UI не должен писать «подключён»
    mode = "demo" if demo_ok and not settings.moy_nalog_enabled else "enabled"
    user.moy_nalog_linked = True  # legacy flag
    user.moy_nalog_status = "admin_enabled" if mode == "enabled" else "authorization_started"
    await db.commit()
    return MoyNalogLinkResponse(
        linked=True,
        mode=mode,
        status=user.moy_nalog_status,
        message=(
            "Demo: интеграция включена без OAuth ФНС. Чеки live недоступны."
            if mode == "demo"
            else "Интеграция включена администратором — аккаунт ФНС ещё не авторизован через OAuth."
        ),
    )



@router.post("/moy-nalog/unlink", response_model=MoyNalogLinkResponse)
async def unlink_moy_nalog(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Отозвать флаг «Мой налог» (пока без provider tokens)."""
    user.moy_nalog_linked = False
    user.moy_nalog_status = "revoked"
    await db.commit()
    return MoyNalogLinkResponse(
        linked=False,
        mode="enabled",
        status="revoked",
        message="Связь «Мой налог» снята. Для реального отзыва в ФНС нужен OAuth revoke.",
    )
