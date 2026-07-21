"""UTC timestamps — timezone-aware wall clock, naive for DB (Python 3.12+).

Returns naive UTC for SQLAlchemy DateTime columns without timezone=True
(same storage shape as legacy utcnow()). Call sites must not mix aware/naive.
"""
from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Current UTC as naive datetime (DB-compatible replacement for utcnow)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
