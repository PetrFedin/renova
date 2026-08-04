"""Canonical replay-safe project checkout route."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import PaymentStatus, PaymentType, Stage, User, UserRole
from app.schemas.project import YookassaCheckoutIn, YookassaCheckoutOut
from app.services import payment_checkout_service as checkout_svc
from app.services import payment_service as pay_svc
from app.services import yookassa_service as yk

router = APIRouter(prefix="/projects", tags=["payments"])


def _integrity_error(exc: checkout_svc.CheckoutIntegrityError) -> HTTPException:
    status_code = 404 if exc.code == "payment_not_found" else 409
    return HTTPException(
        status_code,
        detail={
            "code": exc.code,
            "message": "Не удалось безопасно продолжить платёж через ЮKassa",
        },
    )


def _provider_error(exc: Exception) -> HTTPException:
    provider_status = None
    if isinstance(exc, httpx.HTTPStatusError):
        provider_status = exc.response.status_code
    return HTTPException(
        502,
        detail={
            "code": "yookassa_unavailable",
            "message": "ЮKassa временно недоступна. Повторите запрос — новый платёж создан не будет.",
            "provider_status": provider_status,
        },
    )


async def _return_url(
    *,
    project_id: str,
    payment_id: str,
    user: User,
    body: YookassaCheckoutIn | None,
) -> str:
    return_url = f"renova://payment-return?projectId={project_id}&paymentId={payment_id}"
    portal_token = (body.portal_token if body else None) or None
    if not portal_token:
        return return_url

    from app.services import portal_token_service as portal_tok

    try:
        claims = portal_tok.verify_portal_token(portal_token)
    except ValueError as exc:
        raise HTTPException(401, "invalid_portal_token") from exc
    if claims.get("project_id") != project_id or claims.get("user_id") != user.id:
        raise HTTPException(403, "portal_token_mismatch")
    if "pay" not in (claims.get("scopes") or []):
        raise HTTPException(403, "portal_pay_scope_required")
    portal_base = portal_tok.portal_url(portal_token).split("?", 1)[0]
    return f"{portal_base}?token={portal_token}&paid=1&paymentId={payment_id}"


async def _confirm_verified_provider_payment(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
) -> None:
    confirmed = await pay_svc.confirm_payment(
        db,
        payment_id,
        project_id=project_id,
        allow_without_acceptance=False,
        allow_without_settlement=True,
        commit=True,
    )
    if not confirmed:
        await db.rollback()
        raise HTTPException(
            409,
            detail={
                "code": "provider_payment_confirmation_blocked",
                "message": "Платёж получен, но локальное подтверждение заблокировано состоянием проекта",
            },
        )


@router.post(
    "/{project_id}/payments/{payment_id}/yookassa-checkout",
    response_model=YookassaCheckoutOut,
)
async def yookassa_checkout(
    project_id: str,
    payment_id: str,
    body: YookassaCheckoutIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create, resume, or reconcile one provider checkout without duplicates."""
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Оплату через ЮKassa инициирует заказчик")

    existing = await pay_svc.get_payment(db, payment_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")

    return_url = await _return_url(
        project_id=project_id,
        payment_id=payment_id,
        user=user,
        body=body,
    )

    # A lost response after successful settlement must replay as success.
    if (
        existing.status == PaymentStatus.confirmed
        and existing.payment_method == "yookassa"
        and existing.yookassa_payment_id
    ):
        return YookassaCheckoutOut(
            demo=yk.demo_allowed() and not yk.yookassa_configured(),
            payment_id=payment_id,
            yookassa_payment_id=existing.yookassa_payment_id,
            confirmation_url=return_url,
            status="succeeded",
            message="Платёж уже подтверждён",
        )

    if existing.status not in {PaymentStatus.pending, PaymentStatus.processing}:
        raise HTTPException(
            409,
            detail={
                "code": "payment_not_checkoutable",
                "message": "Платёж уже обработан или закрыт",
            },
        )

    if existing.payment_type == PaymentType.stage and existing.stage_id:
        stage = await db.get(Stage, existing.stage_id)
        if not stage or stage.project_id != project_id or not stage.customer_accepted_at:
            raise HTTPException(409, "Сначала примите этап — оплата без приёмки запрещена")

    try:
        provider = await checkout_svc.create_or_resume_checkout(
            amount=existing.amount,
            description=existing.title,
            return_url=return_url,
            user_id=user.id,
            payment_id=payment_id,
            project_id=project_id,
            existing_provider_id=existing.yookassa_payment_id,
        )
    except (httpx.HTTPError, TimeoutError) as exc:
        raise _provider_error(exc) from exc

    if provider.get("error") == "yookassa_not_configured":
        raise HTTPException(503, provider.get("message", "ЮKassa не настроена на сервере"))

    try:
        provider_id = checkout_svc.validate_provider_snapshot(
            provider,
            expected_provider_id=existing.yookassa_payment_id,
            expected_amount=existing.amount,
            expected_project_id=project_id,
            expected_payment_id=payment_id,
            expected_user_id=user.id,
        )
        await checkout_svc.bind_provider_payment(
            db,
            payment_id=payment_id,
            project_id=project_id,
            provider_payment_id=provider_id,
            commit=False,
        )
    except checkout_svc.CheckoutIntegrityError as exc:
        raise _integrity_error(exc) from exc

    provider_status = str(provider.get("status") or "pending")
    is_demo = bool(provider.get("demo"))
    if is_demo:
        if not yk.demo_allowed():
            await db.rollback()
            raise HTTPException(503, "Для staging/production нужны ключи ЮKassa")
        await _confirm_verified_provider_payment(
            db,
            project_id=project_id,
            payment_id=payment_id,
        )
        return YookassaCheckoutOut(
            demo=True,
            payment_id=payment_id,
            yookassa_payment_id=provider_id,
            confirmation_url=return_url,
            status="succeeded",
            message="Оплата подтверждена (demo ЮKassa)",
        )

    if provider_status == "succeeded":
        # Authenticated provider GET is also a recovery path when webhook delivery
        # was delayed or lost. Money and metadata were checked above.
        if provider.get("remote_amount") is None or provider.get("remote_currency") is None:
            await db.rollback()
            raise HTTPException(
                409,
                detail={
                    "code": "yookassa_settlement_evidence_missing",
                    "message": "ЮKassa не вернула сумму или валюту подтверждённого платежа",
                },
            )
        await _confirm_verified_provider_payment(
            db,
            project_id=project_id,
            payment_id=payment_id,
        )
    else:
        await db.commit()

    return YookassaCheckoutOut(
        demo=False,
        payment_id=payment_id,
        yookassa_payment_id=provider_id,
        confirmation_url=provider.get("confirmation_url"),
        status=provider_status,
        message="Платёж восстановлен" if existing.yookassa_payment_id else None,
    )
