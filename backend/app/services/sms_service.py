"""Twilio SMS delivery with explicit local preview and fail-closed errors."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.phone import normalize_phone


class SmsError(RuntimeError):
    pass


class SmsConfigurationError(SmsError):
    """Local/configuration validation failed before a remote message was accepted."""


class SmsDeliveryFailed(SmsError):
    """Base class retained for existing callers."""


class SmsDeliveryRetryable(SmsDeliveryFailed):
    """Provider explicitly rejected the attempt before accepting a message."""


class SmsDeliveryAmbiguous(SmsDeliveryFailed):
    """The remote write may have succeeded; automatic resend is unsafe."""


class SmsDeliveryRejected(SmsDeliveryFailed):
    """Provider definitively rejected the request; operator remediation is required."""


@dataclass(frozen=True)
class SmsDeliveryResult:
    # Historical field name retained for compatibility. True means the provider
    # accepted and identified a message resource, not handset delivery.
    delivered: bool
    preview: bool = False
    provider_id: str | None = None


def _is_local_environment() -> bool:
    return settings.normalized_environment in {"development", "test"}


def _twilio_configuration() -> tuple[str, str, str] | None:
    sid = (settings.twilio_sid or "").strip()
    token = (settings.twilio_token or "").strip()
    sender_raw = (settings.twilio_from or "").strip()
    configured = [bool(sid), bool(token), bool(sender_raw)]
    if not any(configured):
        if _is_local_environment():
            return None
        raise SmsConfigurationError("twilio_not_configured")
    if not all(configured):
        raise SmsConfigurationError("partial_twilio_configuration")
    if len(sid) > 128 or any(char in sid for char in "\r\n\x00"):
        raise SmsConfigurationError("invalid_twilio_sid")
    if len(token) > 256 or any(char in token for char in "\r\n\x00"):
        raise SmsConfigurationError("invalid_twilio_token")
    try:
        sender = normalize_phone(sender_raw)
    except ValueError as exc:
        raise SmsConfigurationError("invalid_twilio_from") from exc
    return sid, token, sender


def _provider_reported_error(payload: dict) -> bool:
    """Twilio may return a message SID together with a terminal error_code.

    A SID alone therefore cannot be treated as accepted/success evidence when
    the same authoritative response already reports an error. Keep the check
    intentionally narrow and fail-closed without surfacing raw provider text.
    """
    error_code = payload.get("error_code")
    return error_code not in (None, "", 0, "0")


async def send_sms(phone: str, text: str) -> SmsDeliveryResult:
    """Return success only after Twilio accepts and identifies a message.

    Development/test without Twilio is an explicit preview. Working environments
    never degrade to demo success. A network timeout/transport failure or a 5xx is
    classified as *ambiguous*: the remote write may already exist, so callers must
    not blindly repeat it unless a provider-specific idempotency contract proves
    that resend is safe.
    """
    try:
        recipient = normalize_phone(phone)
    except ValueError as exc:
        raise SmsConfigurationError("invalid_sms_recipient") from exc
    body = (text or "").strip()
    if not body or len(body) > 1600 or "\x00" in body:
        raise SmsConfigurationError("invalid_sms_body")

    config = _twilio_configuration()
    if config is None:
        return SmsDeliveryResult(delivered=False, preview=True)
    sid, token, sender = config

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                auth=(sid, token),
                data={"To": recipient, "From": sender, "Body": body},
            )
    except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
        raise SmsDeliveryAmbiguous("twilio_delivery_ambiguous") from exc
    except httpx.HTTPError as exc:
        raise SmsDeliveryAmbiguous("twilio_delivery_ambiguous") from exc

    if response.status_code == 429:
        raise SmsDeliveryRetryable("twilio_rate_limited")
    if response.status_code >= 500:
        raise SmsDeliveryAmbiguous("twilio_server_response_ambiguous")
    if response.status_code >= 400:
        raise SmsDeliveryRejected(f"twilio_http_rejected_{response.status_code}")

    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        # A successful HTTP response with an unreadable body can still correspond
        # to an accepted remote message, therefore resend is unsafe.
        raise SmsDeliveryAmbiguous("twilio_response_ambiguous") from exc

    if not isinstance(payload, dict):
        raise SmsDeliveryAmbiguous("twilio_response_ambiguous")
    provider_id = payload.get("sid")
    if not isinstance(provider_id, str) or not provider_id.strip():
        raise SmsDeliveryAmbiguous("twilio_message_identity_ambiguous")
    if _provider_reported_error(payload):
        # The response itself proves the provider considers this message failed.
        # Do not call it accepted merely because a SID exists.
        raise SmsDeliveryRejected("twilio_message_rejected")

    # A Twilio message SID without an accompanying provider error is evidence
    # that the provider accepted/identified a message resource. It is deliberately
    # not described as handset delivery.
    return SmsDeliveryResult(delivered=True, provider_id=provider_id.strip())
