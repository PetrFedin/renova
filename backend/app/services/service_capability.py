"""Единый контракт capability для интеграций (OCR, Мой налог, …).

Backend — единственный источник истины для mode/available/configured/healthy.
Секреты и внутренние URL в ответы не попадают.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

ServiceMode = Literal["live", "sandbox", "local", "demo", "off", "error"]


def utc_checked_at() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def service_capability(
    *,
    available: bool,
    mode: ServiceMode,
    configured: bool,
    healthy: bool,
    provider: str | None = None,
    message: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Сериализуемый ServiceCapability (обратно совместимое расширение health-ответов)."""
    out: dict[str, Any] = {
        "available": bool(available),
        "mode": mode,
        "provider": provider,
        "configured": bool(configured),
        "healthy": bool(healthy),
        "message": message,
        "checked_at": utc_checked_at(),
    }
    if extra:
        # Только явные безопасные поля — без секретов
        out.update(extra)
    return out
