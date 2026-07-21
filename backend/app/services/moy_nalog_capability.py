"""Capability + production-safe guard для «Мой налог» bypass."""
from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.environment import normalize_environment
from app.services.service_capability import service_capability


def moy_nalog_dev_bypass_allowed() -> bool:
    """Bypass без OAuth только при явном флаге и только non-production.

    Даже если MY_NALOG_DEV_BYPASS_ENABLED=true в staging/production — False.
    Admin role сам по себе не открывает bypass.
    """
    env = normalize_environment(settings.environment)
    if env in ("staging", "production"):
        return False
    if env not in ("development", "test"):
        return False
    return bool(getattr(settings, "moy_nalog_dev_bypass_enabled", False))


def moy_nalog_capability() -> dict[str, Any]:
    from app.services import moy_nalog_oauth as oauth

    env = normalize_environment(settings.environment)
    oauth_configured = bool(oauth.oauth_ready())
    enabled_flag = bool(settings.moy_nalog_enabled)
    bypass = moy_nalog_dev_bypass_allowed()

    if oauth_configured and enabled_flag:
        mode = "live"
        available = True
        healthy = True
        message = "OAuth «Мой налог» настроен"
    elif oauth_configured:
        mode = "sandbox"
        available = True
        healthy = True
        message = "OAuth credentials заданы; MOY_NALOG_ENABLED выключен"
    elif bypass:
        mode = "demo"
        available = True
        healthy = True
        message = "Dev bypass: флаг без OAuth (только development/test)"
    else:
        mode = "off"
        available = False
        healthy = False
        message = "«Мой налог» не настроен (нужен OAuth)"

    return service_capability(
        available=available,
        mode=mode,  # type: ignore[arg-type]
        configured=oauth_configured or bypass,
        healthy=healthy,
        provider="moy_nalog",
        message=message,
        extra={
            "oauth_configured": oauth_configured,
            "connection_available": oauth_configured and enabled_flag,
            "dev_bypass_available": bypass,
            "moy_nalog_enabled": enabled_flag,
            "environment": env,
        },
    )
