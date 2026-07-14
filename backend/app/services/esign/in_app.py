"""In-app e-sign — текущий MVP (подпись в продукте без УНЭП)."""
from __future__ import annotations

import uuid

from app.services.esign.base import SignRequest, SignResult


class InAppESignProvider:
    name = "in_app"
    display_name = "Подпись в приложении"

    def is_available(self) -> bool:
        return True

    async def create_signature(self, request: SignRequest) -> SignResult:
        return SignResult(
            status="signed",
            provider_name=self.name,
            external_id=f"inapp-{uuid.uuid4().hex[:16]}",
            signature_type="in_app",
            meta={
                "mode": "mvp_stub",
                "content_hash": request.content_hash,
                "signer_role": request.signer_role,
            },
        )
