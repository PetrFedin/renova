"""Fiscal receipt QR parsing and fail-closed FNS verification."""
from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qs, quote

import httpx

from app.core.config import settings

log = logging.getLogger("renova.fns.receipt")

VERIFIED_LIVE = "verified_live"
SAVED_UNVERIFIED = "saved_unverified"
VERIFICATION_PENDING = "verification_pending"
VERIFICATION_FAILED = "verification_failed"
INVALID = "invalid"
LEGACY_DEMO_VERIFIED = "demo_verified"


def parse_receipt_qr(raw: str | None) -> dict:
    """Parse the fiscal QR fields required by the FNS receipt service."""
    if not raw or not isinstance(raw, str):
        return {"valid": False, "reason": "empty", "amount": 0.0}
    value = raw.strip()
    parsed = parse_qs(value, keep_blank_values=True)
    get = lambda key: (parsed.get(key) or [None])[0]
    fn = get("fn")
    fd = get("i") or get("fd")
    fp = get("fp")
    amount_raw = get("s")
    time_raw = get("t")
    operation = get("n")
    if not all((fn, fd, fp, amount_raw, time_raw)):
        return {"valid": False, "reason": "required_fields", "amount": 0.0}
    try:
        amount = Decimal(str(amount_raw))
    except (InvalidOperation, ValueError):
        return {"valid": False, "reason": "amount", "amount": 0.0}
    if not amount.is_finite() or amount <= 0:
        return {"valid": False, "reason": "amount", "amount": 0.0}
    if not str(time_raw).replace("T", "").isdigit() or len(str(time_raw)) < 12:
        return {"valid": False, "reason": "date", "amount": float(amount)}
    return {
        "valid": True,
        "fn": str(fn),
        "fd": str(fd),
        "fp": str(fp),
        "amount": float(amount.quantize(Decimal("0.01"))),
        "receipt_time": str(time_raw),
        "operation": str(operation) if operation is not None else None,
        "raw": value,
    }


def receipt_meta(raw: str | None) -> dict:
    """Return display metadata without implying fiscal verification."""
    parsed = parse_receipt_qr(raw)
    if not parsed.get("valid"):
        return {}
    time_raw = str(parsed.get("receipt_time") or "")
    meta: dict[str, Any] = {
        "amount": parsed.get("amount"),
        "fn": parsed.get("fn"),
        "fd": parsed.get("fd"),
        "fp": parsed.get("fp"),
        "operation": parsed.get("operation"),
    }
    if len(time_raw) >= 8:
        meta["receipt_at"] = f"{time_raw[0:4]}-{time_raw[4:6]}-{time_raw[6:8]}"
    return meta


def receipt_auth_configured() -> bool:
    return bool(
        (settings.fns_receipt_login or "").strip()
        and (settings.fns_receipt_password or "").strip()
    )


def receipt_is_live_verified(receipt) -> bool:
    """Only an explicit live verification status is accepted as fiscal evidence."""
    return bool(
        getattr(receipt, "fns_verified", False)
        and str(getattr(receipt, "verification_status", "") or "") == VERIFIED_LIVE
    )


def receipt_verification_truth(status: str | None, fns_verified: bool = False) -> dict:
    normalized = str(status or SAVED_UNVERIFIED)
    verified = bool(fns_verified and normalized == VERIFIED_LIVE)
    return {
        "verification_status": normalized,
        "verified": verified,
        "accepted": verified,
        "valid": verified,
        "pending": normalized == VERIFICATION_PENDING,
        "retryable": normalized in {VERIFICATION_PENDING, SAVED_UNVERIFIED},
        "final": normalized in {VERIFIED_LIVE, VERIFICATION_FAILED, INVALID},
        "legacy_demo": normalized == LEGACY_DEMO_VERIFIED,
    }


def build_receipt_check_url(fn: str, fd: str, fp: str, amount: float) -> str:
    """Build the provider URL; configured templates may contain fiscal placeholders."""
    base = (settings.fns_receipt_api_url or "").strip()
    default = (
        f"https://proverkacheka.nalog.ru:9999/v1/inns/*/kkts/{quote(fn, safe='')}"
        f"/tickets/{quote(fd, safe='')}?fiscalSign={quote(fp, safe='')}&sum={amount}"
    )
    if not base or ("*" in base and "tickets" not in base):
        return default
    if "{fn}" in base:
        return (
            base.replace("{fn}", quote(fn, safe=""))
            .replace("{fd}", quote(fd, safe=""))
            .replace("{fp}", quote(fp, safe=""))
            .replace("{sum}", str(amount))
        )
    return default


def fns_receipt_health() -> dict[str, Any]:
    """Provider readiness without exposing credentials or pretending demo verification."""
    configured = receipt_auth_configured()
    return {
        "environment": settings.normalized_environment,
        "receipt_auth_configured": configured,
        "demo_verify_allowed": False,
        "live_verify_ready": configured,
        "verification_mode": "live" if configured else "unavailable",
        "npd_status_url_set": bool(settings.fns_npd_status_url),
        "moy_nalog_enabled": bool(settings.moy_nalog_enabled),
        "hint": None if configured else "Задайте FNS_RECEIPT_LOGIN + FNS_RECEIPT_PASSWORD для live-проверки чеков",
    }


def _result(status: str, message: str, *, provider_payload: dict | None = None) -> dict:
    truth = receipt_verification_truth(status, status == VERIFIED_LIVE)
    return {
        **truth,
        "status": status,
        "mode": "live" if status in {VERIFIED_LIVE, VERIFICATION_FAILED, INVALID} else "pending",
        "message": message,
        "provider_payload": provider_payload,
    }


def _provider_amount(payload: dict) -> Decimal | None:
    candidates: list[object] = [payload.get("total"), payload.get("sum"), payload.get("amount")]
    for key in ("document", "ticket", "receipt"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            candidates.extend([nested.get("total"), nested.get("sum"), nested.get("amount")])
    for raw in candidates:
        if raw is None:
            continue
        try:
            amount = Decimal(str(raw))
        except (InvalidOperation, ValueError):
            continue
        if not amount.is_finite():
            continue
        # Provider payloads commonly expose the total either in roubles or integer kopecks.
        if amount >= 100 and amount == amount.to_integral_value():
            return (amount / Decimal("100")).quantize(Decimal("0.01"))
        return amount.quantize(Decimal("0.01"))
    return None


def _payload_has_receipt_evidence(payload: dict) -> bool:
    if payload.get("error") or payload.get("errors"):
        return False
    return bool(
        payload.get("document")
        or payload.get("ticket")
        or payload.get("receipt")
        or payload.get("operation")
        or payload.get("id")
    )


async def verify_receipt(parsed: dict) -> dict:
    if not parsed.get("valid", True):
        return _result(INVALID, "Некорректный QR-код чека")
    fn, fd, fp = parsed.get("fn"), parsed.get("fd"), parsed.get("fp")
    amount = float(parsed.get("amount") or 0)
    if not (fn and fd and fp and amount > 0):
        return _result(INVALID, "Неполный или некорректный QR-код")
    if not receipt_auth_configured():
        return _result(
            VERIFICATION_PENDING,
            "Проверка ФНС не настроена: чек сохранён без подтверждения",
        )

    url = build_receipt_check_url(str(fn), str(fd), str(fp), amount)
    auth = (
        (settings.fns_receipt_login or "").strip(),
        settings.fns_receipt_password or "",
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, auth=auth)
    except (httpx.TimeoutException, httpx.NetworkError, httpx.RequestError):
        return _result(
            VERIFICATION_PENDING,
            "ФНС временно недоступна. Проверка будет повторена",
        )

    if response.status_code == 200:
        try:
            provider_payload = response.json()
        except (ValueError, TypeError):
            return _result(VERIFICATION_FAILED, "ФНС вернула некорректный ответ")
        if not isinstance(provider_payload, dict) or not provider_payload:
            return _result(VERIFICATION_FAILED, "ФНС вернула пустой ответ")
        if not _payload_has_receipt_evidence(provider_payload):
            return _result(
                VERIFICATION_FAILED,
                "Ответ ФНС не содержит подтверждения чека",
                provider_payload=provider_payload,
            )
        provider_amount = _provider_amount(provider_payload)
        requested_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
        if provider_amount is not None and provider_amount != requested_amount:
            return _result(
                INVALID,
                "Сумма чека не совпадает с данными ФНС",
                provider_payload=provider_payload,
            )
        return _result(
            VERIFIED_LIVE,
            "ФНС: чек подтверждён",
            provider_payload=provider_payload,
        )

    if response.status_code in {400, 404, 422}:
        return _result(INVALID, "ФНС не подтвердила чек")
    if response.status_code in {408, 425, 429} or response.status_code >= 500:
        return _result(
            VERIFICATION_PENDING,
            "ФНС временно недоступна. Проверка будет повторена",
        )
    if response.status_code in {401, 403}:
        return _result(VERIFICATION_FAILED, "ФНС отклонила учётные данные API")
    log.info("fns receipt http %s", response.status_code)
    return _result(
        VERIFICATION_FAILED,
        f"Проверка ФНС завершилась с HTTP {response.status_code}",
    )


def verify_receipt_stub(parsed: dict) -> dict:
    """Deprecated compatibility helper: never returns verified evidence."""
    return _result(
        SAVED_UNVERIFIED,
        "Stub-проверка отключена: требуется live-подтверждение ФНС",
    )
