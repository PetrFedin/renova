"""Реестр e-sign провайдеров."""
from __future__ import annotations

from app.services.esign.base import ESignProvider
from app.services.esign.external_stub import GOSKEY, KONTUR
from app.services.esign.in_app import InAppESignProvider

_PROVIDERS: dict[str, ESignProvider] = {
    InAppESignProvider.name: InAppESignProvider(),
    KONTUR.name: KONTUR,
    GOSKEY.name: GOSKEY,
}


def get_provider(name: str | None) -> ESignProvider:
    key = (name or "in_app").strip().lower()
    if key not in _PROVIDERS:
        raise KeyError(f"unknown_esign_provider:{key}")
    return _PROVIDERS[key]


def list_providers() -> list[dict]:
    rows = []
    for p in _PROVIDERS.values():
        rows.append(
            {
                "name": p.name,
                "display_name": p.display_name,
                "available": p.is_available(),
            }
        )
    return rows
