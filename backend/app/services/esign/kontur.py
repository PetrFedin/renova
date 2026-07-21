"""Контур.Сайн — sandbox HTTP scaffold + live placeholder."""
from __future__ import annotations

import logging
import uuid

import httpx

from app.core.config import settings
from app.services.esign.base import SignRequest, SignResult

logger = logging.getLogger(__name__)


class KonturESignProvider:
    name = "kontur"
    display_name = "Контур.Сайн"

    def is_available(self) -> bool:
        mode = (settings.kontur_mode or "off").strip().lower()
        if mode in ("", "off", "false", "0"):
            return False
        return bool(settings.kontur_api_key)

    async def _submit_http(self, request: SignRequest, external_id: str, mode: str) -> dict | None:
        """Best-effort POST к KONTUR_API_URL; при ошибке — pending без падения."""
        url = (settings.kontur_api_url or "").strip().rstrip("/")
        if not url:
            return None
        payload = {
            "external_id": external_id,
            "document_id": request.document_id,
            "content_hash": request.content_hash,
            "signer_user_id": request.signer_user_id,
            "mode": mode,
        }
        headers = {"Authorization": f"Bearer {settings.kontur_api_key}"}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(f"{url}/signatures", json=payload, headers=headers)
                if r.status_code >= 400:
                    logger.warning("kontur http %s: %s", r.status_code, r.text[:200])
                    return {"http_status": r.status_code, "error": r.text[:200]}
                return r.json() if r.content else {"http_status": r.status_code}
        except Exception as exc:
            logger.warning("kontur http failed: %s", exc)
            return {"error": str(exc)}

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
        http_meta = await self._submit_http(request, external_id, mode)
        base_meta = {
            "mode": mode,
            "content_hash": request.content_hash,
            "document_id": request.document_id,
            "webhook": "/api/v1/esign/webhooks/kontur",
            "api_url": settings.kontur_api_url,
        }
        if http_meta:
            base_meta["http"] = http_meta
        signing_url = None
        if isinstance(http_meta, dict):
            signing_url = http_meta.get("signing_url") or http_meta.get("url")
        if not signing_url and mode == "sandbox":
            signing_url = f"https://sign.kontur.ru/sandbox/{external_id}"
        if signing_url:
            base_meta["signing_url"] = signing_url
        if mode == "live":
            base_meta["note"] = "live_scaffold — complete via Kontur webhook"
        return SignResult(
            status="pending",
            provider_name=self.name,
            external_id=external_id,
            signature_type="kontur",
            meta=base_meta,
        )
