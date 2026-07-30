"""Startup validation for shared authentication provider stores."""
from __future__ import annotations

import asyncio

from app.core.config import settings
from app.services import otp_service


async def validate_otp_runtime() -> None:
    """Fail startup when working auth flows cannot reach their shared stores."""
    if settings.normalized_environment in {"staging", "production"}:
        await asyncio.to_thread(otp_service._redis_client)

    from app.services import moy_nalog_oauth

    await moy_nalog_oauth.validate_runtime()
