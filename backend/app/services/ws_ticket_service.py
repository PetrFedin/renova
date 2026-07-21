"""Short-lived WebSocket tickets (P2.20) — avoid long-lived JWT in query strings."""
from __future__ import annotations

import secrets
import time
from threading import Lock

_TTL_SEC = 120
_lock = Lock()
# ticket -> (user_id, expires_at)
_store: dict[str, tuple[str, float]] = {}


def issue_ws_ticket(user_id: str, ttl: int = _TTL_SEC) -> tuple[str, int]:
    ticket = secrets.token_urlsafe(24)
    exp = time.time() + ttl
    with _lock:
        _purge_locked()
        _store[ticket] = (user_id, exp)
    return ticket, ttl


def consume_ws_ticket(ticket: str) -> str | None:
    """Validate ticket. Does not delete — allows reconnect within TTL (same tab)."""
    if not ticket:
        return None
    now = time.time()
    with _lock:
        _purge_locked(now)
        row = _store.get(ticket)
        if not row:
            return None
        uid, exp = row
        if exp < now:
            _store.pop(ticket, None)
            return None
        return uid


def _purge_locked(now: float | None = None) -> None:
    now = now if now is not None else time.time()
    dead = [k for k, (_, exp) in _store.items() if exp < now]
    for k in dead:
        _store.pop(k, None)
