"""Startup validation for shared authentication provider stores."""
from __future__ import annotations

from app.core.config import settings
from app.services import otp_redis_recovery


async def validate_otp_runtime() -> None:
    """Fail startup when working auth flows cannot reach their shared stores."""
    if settings.normalized_environment in {"staging", "production"}:
        await otp_redis_recovery.ensure_otp_store(force=True)

    from app.services import moy_nalog_oauth

    await moy_nalog_oauth.validate_runtime()
