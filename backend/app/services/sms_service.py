"""Twilio SMS delivery with explicit local preview and fail-closed errors."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.phone import normalize_phone


class SmsError(RuntimeError):
    pass


class SmsConfigurationError(SmsError):
    pass


class SmsDeliveryFailed(SmsError):
    pass


@dataclass(frozen=True)
class SmsDeliveryResult:
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


async def send_sms(phone: str, text: str) -> SmsDeliveryResult:
    """Return delivered=True only after Twilio accepts and identifies a message.

    Development/test without Twilio is an explicit preview. Working environments
    never degrade to demo success. The SMS body is never returned to callers.
    """
    recipient = normalize_phone(phone)
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
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise SmsDeliveryFailed("twilio_delivery_failed") from exc

    if not isinstance(payload, dict):
        raise SmsDeliveryFailed("twilio_invalid_response")
    provider_id = payload.get("sid")
    if not isinstance(provider_id, str) or not provider_id.strip():
        raise SmsDeliveryFailed("twilio_message_sid_missing")
    error_code = payload.get("error_code")
    if error_code not in (None, "", 0):
        raise SmsDeliveryFailed("twilio_message_rejected")
    return SmsDeliveryResult(delivered=True, provider_id=provider_id.strip())
