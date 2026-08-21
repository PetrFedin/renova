"""Short-lived WebSocket tickets (P2.20) — avoid long-lived JWTs in query strings.

Tickets are stateless, purpose-limited signed credentials. Keeping validation
stateless is important because the HTTP request that mints a ticket and the
subsequent WebSocket upgrade may be handled by different backend workers.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import InvalidTokenError as JWTError

from app.core.config import settings
from app.core.security import ALGORITHM

_TTL_SEC = 120
_TOKEN_TYPE = "ws_ticket"


def issue_ws_ticket(user_id: str, ttl: int = _TTL_SEC) -> tuple[str, int]:
    """Mint a short-lived credential that is valid only for WebSocket auth."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl)
    payload = {
        "sub": user_id,
        "iat": now.timestamp(),
        "exp": int(expires_at.timestamp()),
        "typ": _TOKEN_TYPE,
        "jti": secrets.token_urlsafe(16),
    }
    ticket = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return ticket, ttl


def consume_ws_ticket(ticket: str) -> str | None:
    """Validate a WS ticket and return its user id.

    The ticket intentionally remains reusable until expiry so a client can
    reconnect during the short TTL. Validation has no process-local state, so
    mint and consume can safely land on different workers or replicas.
    """
    if not ticket:
        return None
    try:
        payload = jwt.decode(ticket, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None

    if payload.get("typ") != _TOKEN_TYPE:
        return None
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        return None
    return user_id
