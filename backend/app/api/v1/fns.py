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
    """P4: staging probe ФНС чеки / НПД + capability «Мой налог» (без секретов)."""
    from app.services.fns.receipt_verify import fns_receipt_health
    from app.services.moy_nalog_capability import moy_nalog_capability
    _ = _user
    base = fns_receipt_health()
    base["moy_nalog"] = moy_nalog_capability()
    return base



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
    """Dev-only bypass: флаг без OAuth.

    Требует MY_NALOG_DEV_BYPASS_ENABLED=true и non-production.
    В staging/production всегда 403 (даже при ошибочно выставленном флаге).
    Admin role сам по себе bypass не открывает.
    """
    from app.services.auth_audit import log_auth_event
    from app.services.moy_nalog_capability import moy_nalog_dev_bypass_allowed

    if not moy_nalog_dev_bypass_allowed():
        # Без PII/токенов — только факт запрета
        await log_auth_event(
            db,
            user_id=user.id,
            path="/fns/moy-nalog/link",
            status_code=403,
            note="moy_nalog_bypass_denied",
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "moy_nalog_bypass_forbidden",
                "message": "Ручное включение «Мой налог» без OAuth запрещено. Используйте OAuth или MY_NALOG_DEV_BYPASS_ENABLED в development.",
            },
        )

    user.moy_nalog_linked = True
    user.moy_nalog_status = "authorization_started"
    await db.commit()
    await log_auth_event(
        db,
        user_id=user.id,
        path="/fns/moy-nalog/link",
        status_code=200,
        note="moy_nalog_dev_bypass_ok",
    )
    return MoyNalogLinkResponse(
        linked=True,
        mode="demo",
        status=user.moy_nalog_status,
        message="Dev bypass: флаг включён без OAuth ФНС. Чеки live недоступны.",
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


class MoyNalogOAuthStartResponse(BaseModel):
    status: str
    oauth_ready: bool
    state: str | None = None
    auth_url: str | None = None
    message: str


class MoyNalogOAuthCallbackRequest(BaseModel):
    code: str | None = None
    state: str
    """demo_complete=true только development/test — не ставит connected."""
    demo_complete: bool = False


@router.post("/moy-nalog/oauth/start", response_model=MoyNalogOAuthStartResponse)
async def moy_nalog_oauth_start(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Начать OAuth: status=authorization_started. auth_url только при CLIENT_ID."""
    from app.services import moy_nalog_oauth as oauth

    state = oauth.create_oauth_state(user.id)
    auth_url = oauth.build_authorize_url(state)
    ready = oauth.oauth_ready()
    user.moy_nalog_status = "authorization_started"
    # linked остаётся legacy; не ставим True до callback
    await db.commit()
    if ready and auth_url:
        msg = "Откройте auth_url в браузере и завершите вход в ЛК НПД."
    elif ready:
        msg = "CLIENT_ID задан, но authorize URL пуст — проверьте MOY_NALOG_AUTHORIZE_URL."
    else:
        msg = (
            "OAuth credentials не заданы (MOY_NALOG_CLIENT_ID). "
            "Статус authorization_started без live-подключения. "
            "Для demo: POST oauth/callback с demo_complete=true (только development)."
        )
    return MoyNalogOAuthStartResponse(
        status=user.moy_nalog_status,
        oauth_ready=ready,
        state=state,
        auth_url=auth_url,
        message=msg,
    )


@router.post("/moy-nalog/oauth/callback", response_model=MoyNalogLinkResponse)
async def moy_nalog_oauth_callback(
    body: MoyNalogOAuthCallbackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Завершить OAuth. connected — только после успешного token exchange."""
    from app.services import moy_nalog_oauth as oauth

    if not oauth.consume_oauth_state(body.state, user.id):
        user.moy_nalog_status = "error"
        await db.commit()
        raise HTTPException(400, "invalid_or_expired_oauth_state")

    from app.services.moy_nalog_capability import moy_nalog_dev_bypass_allowed
    from app.services.auth_audit import log_auth_event

    if body.demo_complete and not moy_nalog_dev_bypass_allowed():
        await log_auth_event(
            db,
            user_id=user.id,
            path="/fns/moy-nalog/oauth/callback",
            status_code=403,
            note="moy_nalog_demo_complete_denied",
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "moy_nalog_bypass_forbidden",
                "message": "demo_complete запрещён вне development bypass.",
            },
        )

    if body.demo_complete and moy_nalog_dev_bypass_allowed() and not oauth.oauth_ready():
        user.moy_nalog_linked = True
        user.moy_nalog_status = "authorization_started"
        await db.commit()
        return MoyNalogLinkResponse(
            linked=True,
            mode="demo",
            status=user.moy_nalog_status,
            message="Demo OAuth complete: флаг linked, status=authorization_started (не connected — чеки live недоступны).",
        )

    tokens = await oauth.exchange_code_for_tokens(body.code or "")
    if tokens:
        user.moy_nalog_linked = True
        user.moy_nalog_status = "connected"
        await db.commit()
        return MoyNalogLinkResponse(
            linked=True,
            mode="enabled",
            status="connected",
            message="OAuth успешен — «Мой налог» подключён.",
        )

    user.moy_nalog_status = "error"
    await db.commit()
    return MoyNalogLinkResponse(
        linked=False,
        mode="enabled" if oauth.oauth_ready() else "demo",
        status="error",
        message=(
            "Не удалось обменять code на token. Задайте MOY_NALOG_TOKEN_URL + SECRET "
            "или завершите demo через demo_complete в development."
        ),
    )
