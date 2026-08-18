from __future__ import annotations

import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.rate_limit import RateLimitBackendUnavailable, SharedRateLimiter, rate_limiter
from app.core.request_auth import rate_limit_key

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        *,
        limiter: SharedRateLimiter | None = None,
        window_seconds: float = 60,
    ) -> None:
        super().__init__(app)
        self.limiter = limiter or rate_limiter
        self.window_seconds = window_seconds

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/health"):
            return await call_next(request)

        identity = rate_limit_key(
            authorization=request.headers.get("authorization"),
            x_user_id=request.headers.get("x-user-id"),
            client_host=request.client.host if request.client else None,
        )
        limit = settings.rate_limit_rpm
        if settings.normalized_environment in ("development", "test"):
            limit = max(limit, 400)

        try:
            decision = await self.limiter.check(
                "public-api",
                identity,
                limit=limit,
                window_seconds=self.window_seconds,
            )
        except RateLimitBackendUnavailable:
            logger.error(
                "public API rate-limit backend unavailable",
                extra={"path": request.url.path},
            )
            return JSONResponse(
                {"detail": "rate_limit_backend_unavailable"},
                status_code=503,
                headers={"Retry-After": "1"},
            )

        if not decision.allowed:
            return JSONResponse(
                {"detail": "rate_limit"},
                status_code=429,
                headers={"Retry-After": str(decision.retry_after_seconds)},
            )
        return await call_next(request)
