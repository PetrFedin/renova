"""Extract authenticated subject from request headers (middleware + WS)."""
from __future__ import annotations

from jose import JWTError

from app.core.config import settings
from app.core.security import bearer_user_id, decode_access_token


def user_id_from_authorization(authorization: str | None) -> str | None:
    if not authorization:
        return None
    try:
        return bearer_user_id(authorization)
    except JWTError:
        return None


def user_id_from_access_token(token: str | None) -> str | None:
    if not token or not token.strip():
        return None
    try:
        payload = decode_access_token(token.strip())
    except JWTError:
        return None
    sub = payload.get("sub")
    if not sub or not isinstance(sub, str):
        return None
    if payload.get("typ") not in (None, "access"):
        return None
    return sub


def rate_limit_key(
    *,
    authorization: str | None,
    x_user_id: str | None,
    client_host: str | None,
) -> str:
    uid = user_id_from_authorization(authorization)
    if uid:
        return f"user:{uid}"
    if x_user_id and settings.allow_header_user_id:
        return f"user:{x_user_id}"
    return client_host or "anon"


def audit_user_id(*, authorization: str | None, x_user_id: str | None) -> str | None:
    uid = user_id_from_authorization(authorization)
    if uid:
        return uid
    if x_user_id and settings.allow_header_user_id:
        return x_user_id
    return None
