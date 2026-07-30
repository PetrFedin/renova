"""Startup validation for the shared OTP store."""
from __future__ import annotations

import asyncio

from app.core.config import settings
from app.services import otp_service


async def validate_otp_runtime() -> None:
    """Fail startup when a working environment cannot reach shared Redis."""
    if settings.normalized_environment not in {"staging", "production"}:
        return
    await asyncio.to_thread(otp_service._redis_client)
