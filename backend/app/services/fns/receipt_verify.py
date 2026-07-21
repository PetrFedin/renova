"""ФНС проверка чека по QR (proverkacheka) — live / demo / offline honesty."""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings

log = logging.getLogger("renova.fns.receipt")


def receipt_meta(raw: str | None) -> dict:
    """Дата и сумма из QR без повторного парсинга API."""
    if not raw:
        return {}
    parsed = parse_receipt_qr(raw)
    meta: dict = {"amount": parsed.get("amount")}
    parts = dict(p.split("=", 1) for p in raw.split("&") if "=" in p)
    t_raw = parts.get("t", "")
    if len(t_raw) >= 8:
        meta["receipt_at"] = f"{t_raw[0:4]}-{t_raw[4:6]}-{t_raw[6:8]}"
    return meta


def parse_receipt_qr(raw: str) -> dict:
    parts = dict(p.split("=", 1) for p in raw.split("&") if "=" in p)
    return {
        "fn": parts.get("fn"),
        "fd": parts.get("i") or parts.get("fd"),
        "fp": parts.get("fp"),
        "amount": float(parts.get("s", 0) or 0),
    }


def _demo_verify_allowed() -> bool:
    """Авто-verify без ФНС только development/test — не staging/production."""
    return settings.normalized_environment in ("development", "test")


def receipt_auth_configured() -> bool:
    return bool((settings.fns_receipt_login or "").strip() and (settings.fns_receipt_password or "").strip())


def build_receipt_check_url(fn: str, fd: str, fp: str, amount: float) -> str:
    """Собирает URL проверки. Шаблон settings может содержать * placeholder."""
    base = (settings.fns_receipt_api_url or "").strip()
    # Канон proverkacheka tickets API
    default = (
        f"https://proverkacheka.nalog.ru:9999/v1/inns/*/kkts/{quote(fn, safe='')}"
        f"/tickets/{quote(fd, safe='')}?fiscalSign={quote(fp, safe='')}&sum={amount}"
    )
    if not base or "*" in base and "tickets" not in base:
        return default
    # Если задан полный шаблон с {fn}/{fd}/{fp}/{sum}
    if "{fn}" in base:
        return (
            base.replace("{fn}", quote(fn, safe=""))
            .replace("{fd}", quote(fd, safe=""))
            .replace("{fp}", quote(fp, safe=""))
            .replace("{sum}", str(amount))
        )
    return default


def fns_receipt_health() -> dict[str, Any]:
    """P4 staging probe — без секретов."""
    return {
        "environment": settings.normalized_environment,
        "receipt_auth_configured": receipt_auth_configured(),
        "demo_verify_allowed": _demo_verify_allowed(),
        "live_verify_ready": receipt_auth_configured()
        and settings.normalized_environment in ("staging", "production"),
        "npd_status_url_set": bool(settings.fns_npd_status_url),
        "moy_nalog_enabled": bool(settings.moy_nalog_enabled),
        "hint": (
            None
            if receipt_auth_configured()
            else "Задайте FNS_RECEIPT_LOGIN + FNS_RECEIPT_PASSWORD для live-проверки чеков на staging/prod"
        ),
    }


async def verify_receipt(parsed: dict) -> dict:
    fn, fd, fp = parsed.get("fn"), parsed.get("fd"), parsed.get("fp")
    if not (fn and fd and fp):
        return {"verified": False, "message": "Неполный QR", "mode": "invalid"}
    amount = float(parsed.get("amount") or 0)
    url = build_receipt_check_url(str(fn), str(fd), str(fp), amount)
    auth = None
    if receipt_auth_configured():
        auth = (settings.fns_receipt_login.strip(), settings.fns_receipt_password or "")  # type: ignore[union-attr]
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(url, auth=auth)
            if r.status_code == 200:
                return {"verified": True, "message": "ФНС: чек подтверждён", "mode": "live"}
            if r.status_code in (401, 403):
                return {
                    "verified": False,
                    "message": "ФНС: нужна авторизация API (FNS_RECEIPT_LOGIN/PASSWORD)",
                    "mode": "live",
                }
            log.info("fns receipt http %s", r.status_code)
    except Exception as exc:
        log.warning("fns receipt request failed: %s", exc)

    if _demo_verify_allowed() and fn and amount > 0:
        return {"verified": True, "message": "Dev: чек принят (ФНС offline)", "mode": "demo"}
    return {
        "verified": False,
        "message": "ФНС недоступна — чек сохранён без проверки",
        "mode": "offline",
    }


def verify_receipt_stub(parsed: dict) -> dict:
    ok = bool(parsed.get("fn") and parsed.get("fd"))
    return {"verified": ok, "message": "Stub OK" if ok else "Невалидный QR", "mode": "stub"}
