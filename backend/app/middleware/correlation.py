"""X-Request-Id / correlation id for every response."""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cid = request.headers.get("X-Request-Id") or request.headers.get("X-Correlation-Id")
        if not cid or len(cid) > 128:
            cid = str(uuid.uuid4())
        request.state.correlation_id = cid
        response = await call_next(request)
        response.headers["X-Request-Id"] = cid
        response.headers["X-Correlation-Id"] = cid
        return response
