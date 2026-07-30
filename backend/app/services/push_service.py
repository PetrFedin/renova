"""Expo Push API with truthful ticket handling and permanent-token cleanup."""
from __future__ import annotations

import logging
import re
from collections.abc import Iterator, Sequence

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.entities import PushToken

EXPO_URL = "https://exp.host/--/api/v2/push/send"
MAX_MESSAGES_PER_REQUEST = 100
_TOKEN_RE = re.compile(r"^(?:ExponentPushToken|ExpoPushToken)\[[^\[\]\s]{6,480}\]$")

logger = logging.getLogger(__name__)


def normalize_expo_push_token(raw: str) -> str:
    """Normalize and validate an Expo push token before persistence or delivery."""
    token = (raw or "").strip()
    if len(token) > 512 or not _TOKEN_RE.fullmatch(token):
        raise ValueError("invalid_expo_push_token")
    return token


def _chunks(values: Sequence[str], size: int = MAX_MESSAGES_PER_REQUEST) -> Iterator[list[str]]:
    for start in range(0, len(values), size):
        yield list(values[start : start + size])


def _ticket_error_code(ticket: dict) -> str | None:
    details = ticket.get("details")
    if isinstance(details, dict):
        error = details.get("error")
        if isinstance(error, str) and error:
            return error
    return None


async def _remove_tokens_persistently(tokens: set[str]) -> None:
    """Remove permanently invalid tokens in an isolated transaction.

    Push delivery happens after the business transaction has committed. Using an
    isolated session prevents token cleanup from committing or rolling back
    unrelated caller state.
    """
    if not tokens:
        return
    async with SessionLocal() as cleanup_db:
        await cleanup_db.execute(delete(PushToken).where(PushToken.token.in_(sorted(tokens))))
        await cleanup_db.commit()


async def send_push(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Return whether all deliverable device tokens were accepted by Expo.

    No registered token is a successful no-op because the durable in-app
    notification remains the canonical delivery. HTTP 200 alone is not success:
    every push ticket must be inspected. DeviceNotRegistered tokens are removed
    permanently; transient/provider/payload errors return False so the outbox can
    retry instead of recording a false delivery.
    """
    result = await db.execute(
        select(PushToken)
        .where(PushToken.user_id == user_id)
        .order_by(PushToken.created_at, PushToken.id)
    )
    rows = list(result.scalars().all())
    if not rows:
        return True

    tokens: list[str] = []
    seen: set[str] = set()
    permanently_invalid: set[str] = set()
    for row in rows:
        try:
            token = normalize_expo_push_token(row.token)
        except ValueError:
            permanently_invalid.add(row.token)
            continue
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)

    if not tokens:
        await _remove_tokens_persistently(permanently_invalid)
        return True

    all_deliverable_accepted = True
    async with httpx.AsyncClient(timeout=10) as client:
        for token_chunk in _chunks(tokens):
            messages = [
                {
                    "to": token,
                    "title": title,
                    "body": body,
                    "data": {
                        **(data or {}),
                        "mutableContent": True,
                        "_displayInForeground": True,
                    },
                }
                for token in token_chunk
            ]
            try:
                response = await client.post(
                    EXPO_URL,
                    json=messages,
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                logger.warning("Expo push request failed", exc_info=exc)
                all_deliverable_accepted = False
                break

            if not isinstance(payload, dict) or payload.get("errors"):
                logger.error("Expo push request-level error", extra={"payload": payload})
                all_deliverable_accepted = False
                break

            tickets = payload.get("data")
            if not isinstance(tickets, list) or len(tickets) != len(token_chunk):
                logger.error(
                    "Expo push ticket cardinality mismatch",
                    extra={
                        "expected": len(token_chunk),
                        "actual": len(tickets) if isinstance(tickets, list) else None,
                    },
                )
                all_deliverable_accepted = False
                break

            for token, ticket in zip(token_chunk, tickets, strict=True):
                if not isinstance(ticket, dict):
                    all_deliverable_accepted = False
                    continue
                status = ticket.get("status")
                receipt_id = ticket.get("id")
                if status == "ok" and isinstance(receipt_id, str) and receipt_id:
                    continue
                error_code = _ticket_error_code(ticket)
                if status == "error" and error_code == "DeviceNotRegistered":
                    permanently_invalid.add(token)
                    continue
                logger.warning(
                    "Expo push ticket rejected",
                    extra={
                        "error_code": error_code,
                        "message": ticket.get("message"),
                    },
                )
                all_deliverable_accepted = False

    await _remove_tokens_persistently(permanently_invalid)
    return all_deliverable_accepted
