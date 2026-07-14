"""Контур.Сайн — scaffold (Wave 3f).

live HTTP к Контуру не вызываем без явного KONTUR_MODE=live + ключа.
sandbox: available=True → SignResult pending + external_id для webhook.
"""
from __future__ import annotations

import uuid

from app.core.config import settings
from app.services.esign.base import SignRequest, SignResult


class KonturESignProvider:
    name = "kontur"
    display_name = "Контур.Сайн"

    def is_available(self) -> bool:
        mode = (settings.kontur_mode or "off").strip().lower()
        if mode in ("", "off", "false", "0"):
            return False
        return bool(settings.kontur_api_key)

    async def create_signature(self, request: SignRequest) -> SignResult:
        if not self.is_available():
            return SignResult(
                status="unavailable",
                provider_name=self.name,
                signature_type=self.name,
                error="provider_kontur_not_configured",
                meta={"hint": "Set KONTUR_MODE=sandbox|live and KONTUR_API_KEY"},
            )
        mode = (settings.kontur_mode or "sandbox").strip().lower()
        external_id = f"kontur-{mode}-{uuid.uuid4().hex[:16]}"
        if mode == "live":
            # Scaffold: реального SDK нет — фиксируем намерение, возвращаем pending.
            # Интеграция HTTP появится после аккредитации.
            return SignResult(
                status="pending",
                provider_name=self.name,
                external_id=external_id,
                signature_type="kontur",
                meta={
                    "mode": "live_scaffold",
                    "api_url": settings.kontur_api_url,
                    "content_hash": request.content_hash,
                    "note": "HTTP call not wired — complete via webhook stub",
                },
            )
        return SignResult(
            status="pending",
            provider_name=self.name,
            external_id=external_id,
            signature_type="kontur",
            meta={
                "mode": "sandbox",
                "content_hash": request.content_hash,
                "document_id": request.document_id,
                "webhook": "/api/v1/esign/webhooks/kontur",
            },
        )
