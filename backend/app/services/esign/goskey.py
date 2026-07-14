"""Госключ / Госуслуги — scaffold (Wave 3f)."""
from __future__ import annotations

import uuid

from app.core.config import settings
from app.services.esign.base import SignRequest, SignResult


class GoskeyESignProvider:
    name = "goskey"
    display_name = "Госключ / Госуслуги"

    def is_available(self) -> bool:
        mode = (settings.goskey_mode or "off").strip().lower()
        if mode in ("", "off", "false", "0"):
            return False
        return bool(settings.goskey_client_id)

    async def create_signature(self, request: SignRequest) -> SignResult:
        if not self.is_available():
            return SignResult(
                status="unavailable",
                provider_name=self.name,
                signature_type=self.name,
                error="provider_goskey_not_configured",
                meta={"hint": "Set GOSKEY_MODE=sandbox|live and GOSKEY_CLIENT_ID"},
            )
        mode = (settings.goskey_mode or "sandbox").strip().lower()
        external_id = f"goskey-{mode}-{uuid.uuid4().hex[:16]}"
        return SignResult(
            status="pending",
            provider_name=self.name,
            external_id=external_id,
            signature_type="goskey",
            meta={
                "mode": mode,
                "content_hash": request.content_hash,
                "document_id": request.document_id,
                "webhook": "/api/v1/esign/webhooks/goskey",
            },
        )
