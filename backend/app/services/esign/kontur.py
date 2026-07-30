"""Контур.Сайн provider with fail-closed request acceptance."""
from __future__ import annotations

import hashlib
import logging

import httpx

from app.core.config import settings
from app.services.esign.base import SignRequest, SignResult

logger = logging.getLogger(__name__)

_ACCEPTED_STATUSES = frozenset({"pending", "created", "accepted", "sent", "processing", "awaiting_signature"})
_REJECTED_STATUSES = frozenset({"failed", "error", "rejected", "cancelled", "canceled"})


class KonturProviderError(RuntimeError):
    pass


def _idempotency_id(request: SignRequest) -> str:
    material = "|".join(
        [
            request.document_id,
            request.version_id,
            request.signer_user_id,
            request.signer_role,
            request.content_hash or "",
        ]
    ).encode("utf-8")
    return f"renova-{hashlib.sha256(material).hexdigest()[:48]}"


class KonturESignProvider:
    name = "kontur"
    display_name = "Контур.Сайн"

    def is_available(self) -> bool:
        mode = (settings.kontur_mode or "off").strip().lower()
        return (
            mode in {"sandbox", "live"}
            and bool((settings.kontur_api_key or "").strip())
            and bool((settings.kontur_api_url or "").strip())
            and bool((settings.esign_webhook_secret or "").strip())
        )

    async def _submit_http(self, request: SignRequest, idempotency_id: str, mode: str) -> dict:
        """Submit once and return only a provider-accepted response."""
        url = (settings.kontur_api_url or "").strip().rstrip("/")
        if not url:
            raise KonturProviderError("kontur_api_url_missing")
        payload = {
            "external_id": idempotency_id,
            "document_id": request.document_id,
            "version_id": request.version_id,
            "content_hash": request.content_hash,
            "signer_user_id": request.signer_user_id,
            "signer_role": request.signer_role,
            "title": request.title,
            "mime_type": request.mime_type,
            "mode": mode,
            "webhook_url": f"{settings.public_base_url.rstrip('/')}/api/v1/esign/webhooks/kontur",
        }
        headers = {
            "Authorization": f"Bearer {(settings.kontur_api_key or '').strip()}",
            "Idempotency-Key": idempotency_id,
            "Accept": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(f"{url}/signatures", json=payload, headers=headers)
                response.raise_for_status()
                provider_payload = response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Kontur submission rejected",
                extra={"status_code": exc.response.status_code},
            )
            raise KonturProviderError("kontur_http_rejected") from exc
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("Kontur submission failed", exc_info=exc)
            raise KonturProviderError("kontur_delivery_failed") from exc

        if not isinstance(provider_payload, dict):
            raise KonturProviderError("kontur_invalid_response")
        status = str(provider_payload.get("status") or "").strip().lower()
        if status in _REJECTED_STATUSES:
            raise KonturProviderError("kontur_signature_rejected")
        if status not in _ACCEPTED_STATUSES:
            raise KonturProviderError("kontur_unconfirmed_status")

        external_id = provider_payload.get("external_id") or provider_payload.get("id") or idempotency_id
        if not isinstance(external_id, str) or not external_id.strip() or len(external_id) > 128:
            raise KonturProviderError("kontur_external_id_missing")
        signing_url = provider_payload.get("signing_url") or provider_payload.get("url")
        if signing_url is not None and (not isinstance(signing_url, str) or not signing_url.startswith("https://")):
            raise KonturProviderError("kontur_signing_url_invalid")

        return {
            "external_id": external_id.strip(),
            "status": status,
            "signing_url": signing_url,
            "provider_request_id": provider_payload.get("request_id"),
        }

    async def create_signature(self, request: SignRequest) -> SignResult:
        if not self.is_available():
            return SignResult(
                status="unavailable",
                provider_name=self.name,
                signature_type=self.name,
                error="provider_kontur_not_configured",
                meta={"hint": "Kontur requires mode, API key, API URL and webhook secret"},
            )
        mode = (settings.kontur_mode or "off").strip().lower()
        idempotency_id = _idempotency_id(request)
        try:
            accepted = await self._submit_http(request, idempotency_id, mode)
        except KonturProviderError as exc:
            return SignResult(
                status="failed",
                provider_name=self.name,
                signature_type=self.name,
                error=str(exc),
                meta={
                    "mode": mode,
                    "document_id": request.document_id,
                    "content_hash": request.content_hash,
                },
            )

        meta = {
            "mode": mode,
            "content_hash": request.content_hash,
            "document_id": request.document_id,
            "provider_status": accepted["status"],
            "provider_request_id": accepted.get("provider_request_id"),
            "webhook": "/api/v1/esign/webhooks/kontur",
        }
        if accepted.get("signing_url"):
            meta["signing_url"] = accepted["signing_url"]
        return SignResult(
            status="pending",
            provider_name=self.name,
            external_id=accepted["external_id"],
            signature_type="kontur",
            meta=meta,
        )
