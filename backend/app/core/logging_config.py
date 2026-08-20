from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
import sys

from app.core.config import settings
from app.middleware.correlation import current_correlation_id


def _release_sha() -> str:
    value = (os.getenv("RENOVA_GIT_SHA") or "unknown").strip()
    return value or "unknown"


def _release_digest() -> str:
    value = (os.getenv("RENOVA_IMAGE_DIGEST") or "unknown").strip()
    return value or "unknown"


class JsonFormatter(logging.Formatter):
    """Stable structured log envelope with non-secret release/request context."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "environment": settings.normalized_environment,
            "service": settings.otel_service_name,
            "release": _release_sha(),
            "artifact_digest": _release_digest(),
            "correlation_id": current_correlation_id(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class ContextTextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        correlation_id = current_correlation_id()
        if correlation_id:
            return f"{base} correlation_id={correlation_id}"
        return base


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(ContextTextFormatter("%(levelname)s %(name)s %(message)s"))
    logging.root.handlers = [handler]
    logging.root.setLevel(logging.INFO)
