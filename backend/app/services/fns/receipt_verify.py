import re
import httpx
from app.core.config import settings

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
    return {"fn": parts.get("fn"), "fd": parts.get("i"), "fp": parts.get("fp"), "amount": float(parts.get("s", 0) or 0)}


def _demo_verify_allowed() -> bool:
    """Авто-verify без ФНС только development/test — не staging/production."""
    return settings.normalized_environment in ("development", "test")


async def verify_receipt(parsed: dict) -> dict:
    fn, fd, fp = parsed.get("fn"), parsed.get("fd"), parsed.get("fp")
    if not (fn and fd and fp):
        return {"verified": False, "message": "Неполный QR"}
    amount = parsed.get("amount", 0)
    # Prefer configured URL template if present
    base = (settings.fns_receipt_api_url or "").rstrip("/")
    url = f"https://proverkacheka.nalog.ru:9999/v1/inns/*/kkts/{fn}/tickets/{fd}?fiscalSign={fp}&sum={amount}"
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(url)
            if r.status_code == 200:
                return {"verified": True, "message": "ФНС: чек подтверждён", "mode": "live"}
            if r.status_code in (401, 403):
                return {"verified": False, "message": "ФНС: нужна авторизация API (настройте ключи)", "mode": "live"}
    except Exception:
        pass
    if _demo_verify_allowed() and fn and amount > 0:
        return {"verified": True, "message": "Dev: чек принят (ФНС offline)", "mode": "demo"}
    return {"verified": False, "message": "ФНС недоступна — чек сохранён без проверки", "mode": "offline"}


def verify_receipt_stub(parsed: dict) -> dict:
    ok = bool(parsed.get("fn") and parsed.get("fd"))
    return {"verified": ok, "message": "Stub OK" if ok else "Невалидный QR", "mode": "stub"}
