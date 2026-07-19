"""Email — SMTP when configured, otherwise log-only stub."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

log = logging.getLogger("renova.email")


def _smtp_send_sync(*, to: str, subject: str, body: str) -> None:
    from app.core.config import settings

    host = (settings.smtp_host or "").strip()
    if not host:
        raise RuntimeError("smtp_host empty")
    from_addr = (settings.smtp_from or settings.smtp_user or "noreply@renova.local").strip()
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    port = int(settings.smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        user = (settings.smtp_user or "").strip()
        password = settings.smtp_password or ""
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> None:
    """Единая точка отправки. SMTP если SMTP_HOST задан, иначе log stub."""
    from app.core.config import settings

    if (settings.smtp_host or "").strip():
        try:
            await asyncio.to_thread(_smtp_send_sync, to=to, subject=subject, body=body)
            log.info("EMAIL smtp ok to=%s subject=%s", to, subject)
            return
        except Exception:
            log.exception("EMAIL smtp failed to=%s — fallback log", to)
    log.info("EMAIL to=%s subject=%s body=%s", to, subject, body[:240])


async def send_budget_alert_email(to: str, subject: str, body: str) -> None:
    await send_email(to, subject, body)


async def send_ops_alert_email(to: str, subject: str, body: str) -> None:
    await send_email(to, subject, body)
