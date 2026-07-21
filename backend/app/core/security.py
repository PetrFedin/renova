"""JWT access tokens (HS256) — production auth SoT."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = "HS256"


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """subject = user.id (JWT `sub`)."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=max(5, int(settings.access_token_expire_minutes)))
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "typ": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Raises JWTError if invalid/expired."""
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def bearer_user_id(authorization: str | None) -> str | None:
    """Extract user id from `Authorization: Bearer <jwt>`."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if not token:
        return None
    payload = decode_access_token(token)
    sub = payload.get("sub")
    if not sub or not isinstance(sub, str):
        raise JWTError("missing sub")
    if payload.get("typ") not in (None, "access"):
        raise JWTError("wrong token type")
    return sub
