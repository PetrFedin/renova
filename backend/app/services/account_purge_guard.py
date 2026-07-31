"""Fail-closed authorization for irreversible account purges."""
from __future__ import annotations

import secrets

from app.core.config import settings
from app.core.environment import normalize_environment

MIN_OPS_SECRET_LENGTH = 32


class AccountPurgeForbidden(RuntimeError):
    pass


class AccountPurgeUnavailable(RuntimeError):
    pass


def _valid_secret_shape(value: str | None) -> bool:
    candidate = value or ""
    return (
        MIN_OPS_SECRET_LENGTH <= len(candidate) <= 512
        and not any(char in candidate for char in "\r\n\x00")
    )


def validate_account_purge_access(
    *,
    environment: str,
    enabled: bool,
    configured_secret: str | None,
    provided_secret: str | None,
) -> None:
    """Validate the complete ops contract without leaking the configured secret."""
    if normalize_environment(environment) not in {"staging", "production"}:
        raise AccountPurgeForbidden("account_purge_not_available")
    if not enabled:
        raise AccountPurgeForbidden("account_purge_disabled")
    if not _valid_secret_shape(configured_secret):
        raise AccountPurgeUnavailable("account_purge_not_configured")
    if not _valid_secret_shape(provided_secret):
        raise AccountPurgeForbidden("invalid_account_purge_secret")
    if not secrets.compare_digest(provided_secret or "", configured_secret or ""):
        raise AccountPurgeForbidden("invalid_account_purge_secret")


def authorize_account_purge(provided_secret: str | None) -> None:
    validate_account_purge_access(
        environment=settings.environment,
        enabled=bool(settings.allow_account_purge),
        configured_secret=settings.account_purge_ops_secret,
        provided_secret=provided_secret,
    )
