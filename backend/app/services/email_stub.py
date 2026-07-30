"""Compatibility imports for the fail-closed email delivery service.

New code must import `app.services.email_service`. This module remains only so
older call sites cannot silently retain the former log-only success behavior.
"""
from app.services.email_service import (  # noqa: F401
    EmailConfigurationError,
    EmailDeliveryFailed,
    EmailError,
    send_budget_alert_email,
    send_email,
    send_ops_alert_email,
)

__all__ = [
    "EmailConfigurationError",
    "EmailDeliveryFailed",
    "EmailError",
    "send_budget_alert_email",
    "send_email",
    "send_ops_alert_email",
]
