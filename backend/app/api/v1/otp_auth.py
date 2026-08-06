"""Canonical guarded OTP send and login endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.phone import normalize_phone
from app.db.session import get_db
from app.schemas.auth import UserOut
from app.services import (
    otp_abuse_service,
    otp_login_service,
    otp_redis_recovery,
    otp_service,
)
from app.services.auth_audit import log_auth_event
from app.services.fns.status_npd import check_taxpayer_npd_status

router = APIRouter(prefix="/auth/sms", tags=["auth"])


class OtpSendIn(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    device_id: str | None = Field(default=None, max_length=128)

    _normalize_phone = field_validator("phone")(normalize_phone)


class OtpVerifyIn(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)
    role: str = Field(pattern="^(customer|contractor)$")
    full_name: str | None = Field(default=None, max_length=255)
    inn: str | None = Field(default=None, max_length=12)
    device_id: str | None = Field(default=None, max_length=128)

    _normalize_phone = field_validator("phone")(normalize_phone)


def _client_ip(request: Request) -> str | None:
    # Do not trust caller-controlled forwarding headers without an explicit trusted
    # proxy policy. ASGI server/proxy configuration must resolve the real peer.
    return request.client.host if request.client else None


def _rate_limit(decision: otp_abuse_service.OtpAbuseDecision) -> None:
    if decision.allowed:
        return
    raise HTTPException(
        429,
        "Слишком много попыток. Повторите позже",
        headers={"Retry-After": str(decision.retry_after)},
    )


def _store_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(503, "Сервис кодов временно недоступен")


async def _apply_abuse_guard(
    action: str,
    *,
    phone: str,
    request: Request,
    device_id: str | None,
) -> None:
    """Recover the shared store when due, then atomically consume abuse budget."""
    try:
        await otp_redis_recovery.ensure_otp_store()
        decision = otp_abuse_service.check_and_record(
            action,
            phone=phone,
            ip=_client_ip(request),
            device_id=device_id,
        )
    except otp_service.OtpStoreUnavailable as exc:
        raise _store_unavailable(exc) from exc
    _rate_limit(decision)


@router.post("/send")
async def send_code(body: OtpSendIn, request: Request):
    await _apply_abuse_guard(
        "send",
        phone=body.phone,
        request=request,
        device_id=body.device_id,
    )
    result = await otp_service.send_otp(body.phone)
    if not result.get("ok"):
        if result.get("service_unavailable"):
            raise HTTPException(503, "SMS временно недоступна. Повторите позже")
        if result.get("rate_limited") or result.get("locked"):
            raise HTTPException(429, "Слишком много попыток. Повторите позже")
        raise HTTPException(400, "Не удалось отправить код")
    return result


@router.post("/verify", response_model=UserOut)
async def verify_code(
    body: OtpVerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    ip = _client_ip(request)
    await _apply_abuse_guard(
        "verify",
        phone=body.phone,
        request=request,
        device_id=body.device_id,
    )
    try:
        verified = otp_service.verify_otp(body.phone, body.code)
    except otp_service.OtpStoreUnavailable as exc:
        raise _store_unavailable(exc) from exc
    if not verified:
        await log_auth_event(
            db,
            user_id=None,
            path="/auth/sms/verify",
            status_code=400,
            note="bad_otp",
        )
        raise HTTPException(400, "Неверный или просроченный код")

    npd_verified = False
    if body.role == "contractor" and body.inn and len(body.inn) == 12:
        try:
            npd_verified = bool((await check_taxpayer_npd_status(body.inn))["is_npd"])
        except Exception:
            npd_verified = False
    try:
        result = await otp_login_service.complete_otp_login(
            db,
            phone=body.phone,
            role=body.role,
            full_name=body.full_name,
            inn=body.inn,
            device_id=body.device_id,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
            npd_verified=npd_verified,
        )
    except ValueError as exc:
        if str(exc) == "account_deleted":
            raise HTTPException(403, "account_deleted") from exc
        raise
    out = UserOut.model_validate(result.user, from_attributes=True)
    out.access_token = result.access_token
    out.refresh_token = result.refresh_token
    out.token_type = "bearer"
    return out
