"""X-Request-Id / correlation id for every response and structured log."""
from __future__ import annotations

from contextvars import ContextVar
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


_correlation_id: ContextVar[str | None] = ContextVar(
    "renova_correlation_id",
    default=None,
)


def current_correlation_id() -> str | None:
    """Return the request correlation id for logging/telemetry in this context."""
    return _correlation_id.get()


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cid = request.headers.get("X-Request-Id") or request.headers.get("X-Correlation-Id")
        if not cid or len(cid) > 128:
            cid = str(uuid.uuid4())
        request.state.correlation_id = cid
        token = _correlation_id.set(cid)
        try:
            response = await call_next(request)
            response.headers["X-Request-Id"] = cid
            response.headers["X-Correlation-Id"] = cid
            return response
        finally:
            _correlation_id.reset(token)
