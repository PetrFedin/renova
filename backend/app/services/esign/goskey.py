"""Госключ provider placeholder kept explicitly unavailable until a real API exists."""
from __future__ import annotations

from app.services.esign.base import SignRequest, SignResult


class GoskeyESignProvider:
    name = "goskey"
    display_name = "Госключ / Госуслуги"

    def is_available(self) -> bool:
        """Never advertise a scaffold as a working external provider."""
        return False

    async def create_signature(self, request: SignRequest) -> SignResult:
        return SignResult(
            status="unavailable",
            provider_name=self.name,
            signature_type=self.name,
            error="provider_goskey_not_implemented",
            meta={
                "document_id": request.document_id,
                "content_hash": request.content_hash,
                "hint": "Keep GOSKEY_MODE=off until provider API and callback verification are implemented",
            },
        )
