"""Authenticated, fail-closed API endpoints for FNS and «Мой налог»."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services.fns import FnsNpdError, check_taxpayer_npd_status

router = APIRouter(prefix="/fns", tags=["fns"])


def _fns_error(error: FnsNpdError) -> HTTPException:
    return HTTPException(
        status_code=error.http_status,
        detail={
            "code": error.code,
            "message": str(error),
            "retryable": bool(error.retryable),
            "provider_code": error.provider_code,
        },
    )


def _oauth_error(error) -> HTTPException:
    return HTTPException(
        status_code=getattr(error, "http_status", 502),
        detail={
            "code": getattr(error, "code", "moy_nalog_oauth_error"),
            "message": str(error),
        },
    )


@router.get("/health")
async def fns_health(user: User = Depends(get_current_user)):
    """Provider readiness plus the current user's secret-free OAuth state."""
    from app.services import moy_nalog_oauth as oauth
    from app.services.fns.receipt_verify import fns_receipt_health

    receipt = fns_receipt_health()
    readiness = oauth.oauth_readiness()
    if readiness.ready:
        try:
            connection = (await oauth.connection_state(user.id)).public_dict()
        except oauth.MoyNalogOAuthError:
            connection = {
                "status": "store_unavailable",
                "active": False,
                "expires_at": None,
                "expires_in_seconds": None,
                "refresh_token_retained": False,
            }
    else:
        connection = {
            "status": "not_configured",
            "active": False,
            "expires_at": None,
            "expires_in_seconds": None,
            "refresh_token_retained": False,
        }
    return {
        **receipt,
        "npd_status_url_https": (settings.fns_npd_status_url or "").strip().lower().startswith("https://"),
        "moy_nalog_enabled": readiness.ready,
        "moy_nalog_missing": list(readiness.missing),
        "moy_nalog_connection": connection,
    }


class CheckNpdRequest(BaseModel):
    inn: str = Field(..., min_length=12, max_length=12, pattern=r"^\d{12}$", description="ИНН физлица")
    request_date: date | None = None


class CheckNpdResponse(BaseModel):
    inn: str
    request_date: str
    is_npd: bool
    verified_live: bool
    message: str
    badge: str


@router.post("/check-npd", response_model=CheckNpdResponse)
async def check_npd(body: CheckNpdRequest, _user: User = Depends(get_current_user)) -> CheckNpdResponse:
    try:
        result = await check_taxpayer_npd_status(body.inn, body.request_date)
    except FnsNpdError as error:
        raise _fns_error(error) from error
    return CheckNpdResponse(**result, badge="verified" if result["is_npd"] else "not_npd")


@router.post("/verify-me", response_model=CheckNpdResponse)
async def verify_me(
    body: CheckNpdRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CheckNpdResponse:
    try:
        result = await check_taxpayer_npd_status(body.inn, body.request_date)
    except FnsNpdError as error:
        raise _fns_error(error) from error
    user.inn = result["inn"]
    user.npd_verified = result["is_npd"] is True
    await db.commit()
    return CheckNpdResponse(**result, badge="verified" if result["is_npd"] else "not_npd")


class MoyNalogLinkResponse(BaseModel):
    linked: bool
    message: str
    mode: str = "enabled"
    status: str = "not_connected"


@router.post("/moy-nalog/link", response_model=MoyNalogLinkResponse)
async def link_moy_nalog(_user: User = Depends(get_current_user)):
    raise HTTPException(
        410,
        detail={
            "code": "moy_nalog_legacy_link_removed",
            "message": "Используйте /fns/moy-nalog/oauth/start. Без OAuth linked=true запрещён.",
        },
    )


@router.post("/moy-nalog/unlink", response_model=MoyNalogLinkResponse)
async def unlink_moy_nalog(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import moy_nalog_oauth as oauth

    if oauth.oauth_ready():
        try:
            await oauth.revoke_tokens(user.id)
        except oauth.MoyNalogOAuthError as error:
            raise _oauth_error(error) from error
    user.moy_nalog_linked = False
    user.moy_nalog_status = "revoked"
    await db.commit()
    return MoyNalogLinkResponse(
        linked=False,
        status="revoked",
        message="Локальная OAuth-связь и сохранённые токены удалены.",
    )


class MoyNalogOAuthStartResponse(BaseModel):
    status: str
    oauth_ready: bool
    state: str | None = None
    auth_url: str | None = None
    message: str


class MoyNalogOAuthCallbackRequest(BaseModel):
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=16, max_length=512)
    demo_complete: bool = False


@router.post("/moy-nalog/oauth/start", response_model=MoyNalogOAuthStartResponse)
async def moy_nalog_oauth_start(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import moy_nalog_oauth as oauth

    readiness = oauth.oauth_readiness()
    if not readiness.ready:
        user.moy_nalog_linked = False
        user.moy_nalog_status = "not_connected"
        await db.commit()
        raise HTTPException(
            503,
            detail={
                "code": "moy_nalog_not_configured",
                "message": "OAuth «Мой налог» не настроен полностью",
                "missing": list(readiness.missing),
            },
        )
    try:
        state = await oauth.create_oauth_state(user.id)
        auth_url = oauth.build_authorize_url(state)
    except oauth.MoyNalogOAuthError as error:
        user.moy_nalog_linked = False
        user.moy_nalog_status = "error"
        await db.commit()
        raise _oauth_error(error) from error
    user.moy_nalog_linked = False
    user.moy_nalog_status = "authorization_started"
    await db.commit()
    return MoyNalogOAuthStartResponse(
        status="authorization_started",
        oauth_ready=True,
        state=state,
        auth_url=auth_url,
        message="Откройте auth_url и завершите авторизацию. Подключение появится только после сохранения токена.",
    )


@router.post("/moy-nalog/oauth/callback", response_model=MoyNalogLinkResponse)
async def moy_nalog_oauth_callback(
    body: MoyNalogOAuthCallbackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import moy_nalog_oauth as oauth

    if body.demo_complete:
        raise HTTPException(
            400,
            detail={"code": "moy_nalog_demo_disabled", "message": "Demo OAuth не создаёт подключение"},
        )
    try:
        state_valid = await oauth.consume_oauth_state(body.state, user.id)
        if not state_valid:
            raise oauth.MoyNalogStateError("OAuth state недействителен, истёк или принадлежит другому пользователю")
        tokens = await oauth.exchange_code_for_tokens(body.code)
        await oauth.store_tokens(user.id, tokens)
        if not await oauth.connection_active(user.id):
            raise oauth.MoyNalogStoreUnavailable("Сохранённый OAuth token не подтверждён")
    except oauth.MoyNalogOAuthError as error:
        user.moy_nalog_linked = False
        user.moy_nalog_status = "error"
        await db.commit()
        raise _oauth_error(error) from error

    user.moy_nalog_linked = True
    user.moy_nalog_status = "connected"
    await db.commit()
    return MoyNalogLinkResponse(
        linked=True,
        status="connected",
        message="OAuth подтверждён; действующий access token зашифрован отдельным credential keyring.",
    )