"""Fail-closed access-token session epoch validation."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Mapping


class AccessTokenGuardError(ValueError):
    """Base class for invalid session epoch claims."""


class AccessTokenRevoked(AccessTokenGuardError):
    """The access token predates the user's global invalidation cutoff."""


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def issued_at_utc_naive(payload: Mapping[str, Any]) -> datetime:
    issued_at = payload.get("iat")
    if isinstance(issued_at, bool) or not isinstance(issued_at, (int, float)):
        raise AccessTokenGuardError("session_token_invalid_iat")
    numeric = float(issued_at)
    if not math.isfinite(numeric):
        raise AccessTokenGuardError("session_token_invalid_iat")
    try:
        return datetime.fromtimestamp(numeric, tz=timezone.utc).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError):
        raise AccessTokenGuardError("session_token_invalid_iat") from None


def assert_access_token_not_revoked(
    payload: Mapping[str, Any],
    *,
    user_id: str,
    invalid_before: datetime,
) -> None:
    if payload.get("sub") != user_id:
        raise AccessTokenGuardError("session_token_subject_mismatch")
    if payload.get("typ") not in (None, "access"):
        raise AccessTokenGuardError("session_token_wrong_type")
    if issued_at_utc_naive(payload) < _utc_naive(invalid_before):
        raise AccessTokenRevoked("session_revoked")
