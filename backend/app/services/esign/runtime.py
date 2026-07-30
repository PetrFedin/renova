"""Startup policy for external e-sign providers."""
from __future__ import annotations

from urllib.parse import urlparse

from app.core.config import settings

_ALLOWED_MODES = frozenset({"off", "sandbox", "live"})


def _mode(value: str | None) -> str:
    raw = (value or "off").strip().lower()
    if raw in {"", "false", "0"}:
        return "off"
    return raw


def _safe_secret(value: str | None, *, minimum: int = 16) -> bool:
    secret = (value or "").strip()
    return len(secret) >= minimum and not any(char in secret for char in "\r\n\x00")


def validate_esign_runtime() -> None:
    """Fail startup if an advertised external provider cannot operate safely."""
    errors: list[str] = []
    environment = settings.normalized_environment
    kontur_mode = _mode(settings.kontur_mode)
    goskey_mode = _mode(settings.goskey_mode)

    if kontur_mode not in _ALLOWED_MODES:
        errors.append(f"KONTUR_MODE={kontur_mode!r} is unsupported")
    if goskey_mode not in _ALLOWED_MODES:
        errors.append(f"GOSKEY_MODE={goskey_mode!r} is unsupported")

    if kontur_mode in {"sandbox", "live"}:
        api_key = (settings.kontur_api_key or "").strip()
        api_url = (settings.kontur_api_url or "").strip()
        if not api_key or any(char in api_key for char in "\r\n\x00"):
            errors.append("Kontur mode requires a valid KONTUR_API_KEY")
        parsed = urlparse(api_url)
        if not api_url or parsed.scheme not in ({"https"} if environment in {"staging", "production"} else {"http", "https"}) or not parsed.netloc:
            errors.append("Kontur mode requires a valid HTTPS KONTUR_API_URL in working environments")
        if not _safe_secret(settings.esign_webhook_secret):
            errors.append("Kontur mode requires ESIGN_WEBHOOK_SECRET with at least 16 safe characters")

    if goskey_mode in {"sandbox", "live"}:
        errors.append(
            "GOSKEY_MODE must remain off: provider API submission and callback verification are not implemented"
        )

    if errors:
        raise ValueError("E-sign runtime guard failed:\n- " + "\n- ".join(errors))
