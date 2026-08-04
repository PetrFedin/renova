"""Canonical guarded OTP send and login endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.phone import normalize_phone
from app.db.session import get_db
from app.schemas.auth import UserOut
from app.services import otp_abuse_service, otp_login_service, otp_service
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
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip() or None
    return request.client.host if request.client else None


def _rate_limit(decision: otp_abuse_service.OtpAbuseDecision, response: Response) -> None:
    if decision.allowed:
        return
    response.headers["Retry-After"] = str(decision.retry_after)
    raise HTTPException(429, "Слишком много попыток. Повторите позже")


@router.post("/send")
async def send_code(body: OtpSendIn, request: Request, response: Response):
    decision = otp_abuse_service.check_and_record(
        "send",
        phone=body.phone,
        ip=_client_ip(request),
        device_id=body.device_id,
    )
    _rate_limit(decision, response)
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
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    ip = _client_ip(request)
    decision = otp_abuse_service.check_and_record(
        "verify",
        phone=body.phone,
        ip=ip,
        device_id=body.device_id,
    )
    _rate_limit(decision, response)
    try:
        verified = otp_service.verify_otp(body.phone, body.code)
    except otp_service.OtpStoreUnavailable as exc:
        raise HTTPException(503, "Сервис кодов временно недоступен") from exc
    if not verified:
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
