"""Email stub — логирует отправку (prod: SMTP/SendGrid)."""
import logging
log = logging.getLogger("renova.email")

async def send_budget_alert_email(to: str, subject: str, body: str) -> None:
    log.info("EMAIL to=%s subject=%s body=%s", to, subject, body[:120])
