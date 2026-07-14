"""Заглушки внешних УНЭП/УКЭП провайдеров (недоступны до интеграции)."""
from __future__ import annotations

from app.services.esign.base import SignRequest, SignResult


class ExternalStubProvider:
    """Общая заглушка: available=False → API отдаёт 501."""

    def __init__(self, name: str, display_name: str):
        self.name = name
        self.display_name = display_name

    def is_available(self) -> bool:
        return False

    async def create_signature(self, request: SignRequest) -> SignResult:
        return SignResult(
            status="unavailable",
            provider_name=self.name,
            signature_type=self.name,
            error=f"provider_{self.name}_not_configured",
            meta={"hint": "Подключить после аккредитации / env keys"},
        )


KONTUR = ExternalStubProvider("kontur", "Контур.Сайн (планируется)")
GOSKEY = ExternalStubProvider("goskey", "Госключ / Госуслуги (планируется)")
