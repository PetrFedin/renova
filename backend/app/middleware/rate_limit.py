import time
from collections import defaultdict
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from app.core.config import settings
from app.core.request_auth import rate_limit_key

_buckets: dict[str, list[float]] = defaultdict(list)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/health"):
            return await call_next(request)
        key = rate_limit_key(
            authorization=request.headers.get("Authorization"),
            x_user_id=request.headers.get("X-User-Id"),
            client_host=request.client.host if request.client else None,
        )
        now = time.time()
        win = _buckets[key]
        win[:] = [t for t in win if now - t < 60]
        # Local/dev: stage detail fires 5+ GETs per reload × bus notify → 120 rpm слишком жёстко
        limit = settings.rate_limit_rpm
        if settings.normalized_environment in ("development", "test"):
            limit = max(limit, 400)
        if len(win) >= limit:
            return JSONResponse(
                {"detail": "rate_limit"},
                status_code=429,
                headers={"Retry-After": "2"},
            )
        win.append(now)
        return await call_next(request)
