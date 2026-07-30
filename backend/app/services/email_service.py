"""Email delivery with explicit local preview and fail-closed SMTP semantics."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from email.utils import parseaddr

from app.core.config import settings

logger = logging.getLogger("renova.email")


class EmailError(RuntimeError):
    pass


class EmailConfigurationError(EmailError):
    pass


class EmailDeliveryFailed(EmailError):
    pass


def _is_local_environment() -> bool:
    return settings.normalized_environment in {"development", "test"}


def _clean_header(value: str, *, field: str, max_length: int) -> str:
    cleaned = (value or "").strip()
    if not cleaned or len(cleaned) > max_length or "\r" in cleaned or "\n" in cleaned:
        raise EmailConfigurationError(f"invalid_email_{field}")
    return cleaned


def _recipient(value: str) -> str:
    cleaned = _clean_header(value, field="recipient", max_length=320)
    display_name, address = parseaddr(cleaned)
    if display_name or address != cleaned or address.count("@") != 1:
        raise EmailConfigurationError("invalid_email_recipient")
    local, domain = address.rsplit("@", 1)
    if not local or not domain or "." not in domain or " " in address:
        raise EmailConfigurationError("invalid_email_recipient")
    return address


def _sender() -> str:
    candidate = (settings.smtp_from or settings.smtp_user or "").strip()
    if not candidate:
        if _is_local_environment():
            return "noreply@renova.local"
        raise EmailConfigurationError("smtp_from_missing")
    return _recipient(candidate)


def _smtp_send_sync(*, to: str, subject: str, body: str) -> None:
    host = (settings.smtp_host or "").strip()
    if not host:
        raise EmailConfigurationError("smtp_host_missing")
    if "\r" in host or "\n" in host or len(host) > 255:
        raise EmailConfigurationError("invalid_smtp_host")

    recipient = _recipient(to)
    safe_subject = _clean_header(subject, field="subject", max_length=255)
    from_addr = _sender()
    port = int(settings.smtp_port or 587)
    if port < 1 or port > 65535:
        raise EmailConfigurationError("invalid_smtp_port")

    user = (settings.smtp_user or "").strip()
    password = settings.smtp_password or ""
    if user and not password:
        raise EmailConfigurationError("smtp_password_missing")

    message = EmailMessage()
    message["From"] = from_addr
    message["To"] = recipient
    message["Subject"] = safe_subject
    message.set_content(body or "")

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if user:
            smtp.login(user, password)
        refused = smtp.send_message(message)
        if refused:
            raise EmailDeliveryFailed("smtp_recipient_refused")


async def send_email(to: str, subject: str, body: str) -> bool:
    """Send via SMTP and return True only after provider acceptance.

    Development/test without SMTP is an explicit preview (`False`), not delivery.
    Staging/production without SMTP fails closed. Configured SMTP failures always
    raise and never degrade into a misleading log-only success.
    """
    recipient = _recipient(to)
    safe_subject = _clean_header(subject, field="subject", max_length=255)
    host = (settings.smtp_host or "").strip()

    if not host:
        if not _is_local_environment():
            raise EmailConfigurationError("smtp_host_missing")
        logger.warning(
            "EMAIL preview only to=%s subject=%s body_length=%s",
            recipient,
            safe_subject,
            len(body or ""),
        )
        return False

    try:
        await asyncio.to_thread(
            _smtp_send_sync,
            to=recipient,
            subject=safe_subject,
            body=body or "",
        )
    except EmailConfigurationError:
        raise
    except EmailDeliveryFailed:
        raise
    except Exception as exc:
        logger.exception(
            "EMAIL smtp failed to=%s subject=%s",
            recipient,
            safe_subject,
        )
        raise EmailDeliveryFailed("smtp_delivery_failed") from exc

    logger.info("EMAIL smtp accepted to=%s subject=%s", recipient, safe_subject)
    return True


async def send_budget_alert_email(to: str, subject: str, body: str) -> bool:
    return await send_email(to, subject, body)


async def send_ops_alert_email(to: str, subject: str, body: str) -> bool:
    return await send_email(to, subject, body)
