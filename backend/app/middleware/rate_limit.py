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

# Credential endpoints. `/api/v1/auth` covers login, refresh, logout and the
# `/auth/sms` OTP router mounted underneath it.
AUTH_PATH_PREFIXES: tuple[str, ...] = ("/api/v1/auth",)

_RELAXED_ENVIRONMENTS = ("development", "test")
_RELAXED_FLOOR = 400


def is_auth_path(path: str) -> bool:
    """Match on a path-segment boundary.

    A bare ``startswith`` would also capture unrelated siblings such as
    ``/api/v1/authors`` and silently apply the credential quota to them.
    """
    return any(
        path == prefix or path.startswith(f"{prefix}/")
        for prefix in AUTH_PATH_PREFIXES
    )


def _effective_limit(configured: int) -> int:
    """Local/test runs must not trip production quotas during a suite."""
    if settings.normalized_environment in _RELAXED_ENVIRONMENTS:
        return max(configured, _RELAXED_FLOOR)
    return configured


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

    def _backend_unavailable(self, path: str) -> JSONResponse:
        logger.error(
            "public API rate-limit backend unavailable",
            extra={"path": path},
        )
        return JSONResponse(
            {"detail": "rate_limit_backend_unavailable"},
            status_code=503,
            headers={"Retry-After": "1"},
        )

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path.startswith("/health"):
            return await call_next(request)

        client_host = request.client.host if request.client else None
        identity = rate_limit_key(
            authorization=request.headers.get("authorization"),
            x_user_id=request.headers.get("x-user-id"),
            client_host=client_host,
        )

        # (bucket, identity, limit) pairs applied in order. A credential request
        # consumes the generic quota *and* its own smaller one, so the auth
        # policy is strictly tighter than the previous single-bucket behaviour.
        checks: list[tuple[str, str, int]] = [
            ("public-api", identity, _effective_limit(settings.rate_limit_rpm)),
        ]
        if is_auth_path(path):
            # Deliberately keyed by network origin, not by user: credential
            # endpoints are mostly unauthenticated and the control being bought
            # here is anti-bruteforce/anti-enumeration per source.
            checks.append(
                (
                    "auth-credentials",
                    f"ip:{client_host or 'anon'}",
                    _effective_limit(settings.auth_rate_limit_rpm),
                )
            )

        for bucket, bucket_identity, limit in checks:
            try:
                decision = await self.limiter.check(
                    bucket,
                    bucket_identity,
                    limit=limit,
                    window_seconds=self.window_seconds,
                )
            except RateLimitBackendUnavailable:
                return self._backend_unavailable(path)

            if not decision.allowed:
                return JSONResponse(
                    {"detail": "rate_limit"},
                    status_code=429,
                    headers={"Retry-After": str(decision.retry_after_seconds)},
                )

        return await call_next(request)
