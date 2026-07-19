"""Email stub — логирует отправку (prod: SMTP/SendGrid)."""
from __future__ import annotations

import logging

log = logging.getLogger("renova.email")


async def send_email(to: str, subject: str, body: str) -> None:
    """Единая точка отправки. Сейчас log-only; SMTP — через env в будущем."""
    log.info("EMAIL to=%s subject=%s body=%s", to, subject, body[:240])


async def send_budget_alert_email(to: str, subject: str, body: str) -> None:
    await send_email(to, subject, body)


async def send_ops_alert_email(to: str, subject: str, body: str) -> None:
    await send_email(to, subject, body)
