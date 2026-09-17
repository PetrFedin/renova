"""Claim/complete/replay a client-originated mutation by its stable request id.

Design boundary — read this before changing the failure handling.

The middleware cannot join the route's database transaction: the route owns its
own session and commits it. That makes exactly one window unavoidable, between
the business commit and the ledger completion. This module resolves that window
by *failing closed*:

* a claim that is still ``in_progress`` answers ``409 idempotent_request_in_flight``
  instead of executing the mutation a second time;
* a claim is only released (so the request may be retried) when the route
  provably did not commit business state — a transport-level failure or a 5xx,
  where the response never reached the client either way.

The consequence is deliberate: a crash in that window leaves a stuck claim and
the client sees 409 rather than silently creating a duplicate payment. A stuck
claim is an operator-visible condition, a duplicate financial record is not.

This never replaces ``client_write_idempotency``. That mechanism commits its
ledger row inside the business transaction and has no such window; routes that
support it keep the stronger guarantee and are unaffected.
"""
from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.client_request_replay import (
    STATE_COMPLETED,
    STATE_IN_PROGRESS,
    ClientRequestReplay,
)

logger = logging.getLogger("renova.idempotency")

# Responses larger than this are not retained. A replay then fails closed
# rather than returning an empty or truncated body. Create-endpoint responses
# are far below this.
MAX_RETAINED_RESPONSE_BYTES = 64 * 1024

MAX_REQUEST_KEY_LENGTH = 128


class ReplayConflict(Exception):
    """The same request key was reused for a materially different request."""


class ReplayInFlight(Exception):
    """A claim for this key exists and has not completed."""


class ReplayUnavailable(Exception):
    """The original response was not retained, so it cannot be replayed."""


def request_hash(*, method: str, path: str, body: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(method.upper().encode("utf-8"))
    digest.update(b"\n")
    digest.update(path.encode("utf-8"))
    digest.update(b"\n")
    digest.update(body)
    return digest.hexdigest()


def is_valid_request_key(value: str | None) -> bool:
    if not value:
        return False
    candidate = value.strip()
    if not candidate or len(candidate) > MAX_REQUEST_KEY_LENGTH:
        return False
    # Opaque client token: printable ASCII without separators that would make
    # the value ambiguous in logs or headers.
    return all(33 <= ord(char) <= 126 for char in candidate)


async def _find(
    db: AsyncSession, *, user_id: str, request_key: str
) -> ClientRequestReplay | None:
    result = await db.execute(
        select(ClientRequestReplay).where(
            ClientRequestReplay.user_id == user_id,
            ClientRequestReplay.request_key == request_key,
        )
    )
    return result.scalar_one_or_none()


async def claim(
    db: AsyncSession,
    *,
    user_id: str,
    request_key: str,
    method: str,
    path: str,
    body: bytes,
) -> tuple[bool, ClientRequestReplay | None]:
    """Try to become the single executor of this request.

    Returns ``(True, None)`` when the caller owns the claim and must execute the
    route. Returns ``(False, row)`` when a completed claim can be replayed.
    Raises ``ReplayConflict`` / ``ReplayInFlight`` / ``ReplayUnavailable``
    otherwise.
    """
    expected = request_hash(method=method, path=path, body=body)

    row = ClientRequestReplay(
        user_id=user_id,
        request_key=request_key,
        method=method.upper(),
        path=path,
        request_hash=expected,
        state=STATE_IN_PROGRESS,
        created_at=utc_now(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    else:
        return True, None

    existing = await _find(db, user_id=user_id, request_key=request_key)
    if existing is None:
        # The unique violation came from a concurrent claim that has since been
        # released. Treat it as in-flight rather than executing a second time.
        raise ReplayInFlight("idempotent_request_in_flight")

    if existing.request_hash != expected:
        raise ReplayConflict("idempotency_key_reused_with_different_payload")

    if existing.state != STATE_COMPLETED:
        raise ReplayInFlight("idempotent_request_in_flight")

    if not existing.response_retained:
        raise ReplayUnavailable("idempotent_replay_unavailable")

    return False, existing


async def complete(
    db: AsyncSession,
    *,
    user_id: str,
    request_key: str,
    status_code: int,
    body: bytes,
    media_type: str | None,
) -> None:
    """Record the authoritative response for future replays."""
    row = await _find(db, user_id=user_id, request_key=request_key)
    if row is None:
        logger.warning(
            "idempotency claim vanished before completion user_id=%s", user_id
        )
        return

    retained = len(body) <= MAX_RETAINED_RESPONSE_BYTES
    row.state = STATE_COMPLETED
    row.status_code = status_code
    row.response_retained = retained
    row.response_media_type = media_type
    row.response_body = body.decode("utf-8", errors="replace") if retained else None
    row.completed_at = utc_now()
    await db.commit()


async def release(db: AsyncSession, *, user_id: str, request_key: str) -> None:
    """Drop a claim so the client may retry.

    Only safe when the route provably did not commit business state.
    """
    row = await _find(db, user_id=user_id, request_key=request_key)
    if row is None or row.state == STATE_COMPLETED:
        return
    await db.delete(row)
    await db.commit()
