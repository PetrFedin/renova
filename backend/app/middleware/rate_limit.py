import time
from collections import defaultdict
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from app.core.config import settings

_buckets: dict[str, list[float]] = defaultdict(list)

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/health"):
            return await call_next(request)
        key = request.headers.get("X-User-Id") or (request.client.host if request.client else "anon")
        now = time.time()
        win = _buckets[key]
        win[:] = [t for t in win if now - t < 60]
        if len(win) >= settings.rate_limit_rpm:
            return JSONResponse({"detail": "rate_limit"}, status_code=429)
        win.append(now)
        return await call_next(request)
