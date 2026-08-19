"""Expo Push API with truthful ticket handling and permanent-token cleanup."""
from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Iterator, Sequence

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.entities import PushToken
from app.services.push_receipt_service import (
    AcceptedPushTicket,
    record_accepted_tickets_persistently,
)

EXPO_URL = "https://exp.host/--/api/v2/push/send"
MAX_MESSAGES_PER_REQUEST = 100
PUSH_CATEGORY_ID = "STAGE"
_TOKEN_RE = re.compile(r"^(?:ExponentPushToken|ExpoPushToken)\[[^\[\]\s]{6,480}\]$")
_DELIVERY_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")

logger = logging.getLogger(__name__)


def normalize_expo_push_token(raw: str) -> str:
    """Normalize and validate an Expo push token before persistence or delivery."""
    token = (raw or "").strip()
    if len(token) > 512 or not _TOKEN_RE.fullmatch(token):
        raise ValueError("invalid_expo_push_token")
    return token


def stable_push_delivery_id(source_id: str) -> str:
    """Derive an opaque stable provider/client delivery identity from durable state."""
    source = str(source_id or "").strip()
    if not source:
        raise ValueError("push_delivery_source_id_required")
    digest = hashlib.sha256(f"renova:push:{source}".encode("utf-8")).hexdigest()
    return f"rn_{digest[:40]}"


def normalize_push_delivery_id(raw: str) -> str:
    delivery_id = str(raw or "").strip()
    if not _DELIVERY_ID_RE.fullmatch(delivery_id):
        raise ValueError("invalid_push_delivery_id")
    return delivery_id


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
    *,
    delivery_id: str | None = None,
) -> bool:
    """Return whether all deliverable device tokens were accepted and ticketed.

    No registered token is a successful no-op because the durable in-app
    notification remains the canonical delivery. HTTP 200 alone is not success:
    every push ticket must be inspected. Successful ticket IDs are persisted in
    an isolated receipt ledger before the caller may mark its side effect
    delivered. DeviceNotRegistered ticket errors remove invalid tokens; other
    provider/payload failures return False so the outbox can retry.

    Expo transport is still at-least-once. A stable delivery_id is propagated to
    provider collapse/tag fields and to the app payload so retries can replace or
    suppress duplicate user-visible effects without pretending the provider
    offers request-level exactly-once semantics.
    """
    normalized_delivery_id = (
        normalize_push_delivery_id(delivery_id) if delivery_id is not None else None
    )
    result = await db.execute(
        select(PushToken)
        .where(PushToken.user_id == user_id)
        .order_by(PushToken.created_at, PushToken.id)
    )
    rows = list(result.scalars().all())
    if not rows:
        return True

    tokens: list[str] = []
    token_rows: dict[str, PushToken] = {}
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
        token_rows[token] = row

    if not tokens:
        await _remove_tokens_persistently(permanently_invalid)
        return True

    payload_data = {**(data or {}), "_displayInForeground": True}
    if normalized_delivery_id:
        payload_data["delivery_id"] = normalized_delivery_id

    all_deliverable_accepted = True
    async with httpx.AsyncClient(timeout=10) as client:
        for token_chunk in _chunks(tokens):
            messages: list[dict[str, object]] = []
            for token in token_chunk:
                message: dict[str, object] = {
                    "to": token,
                    "title": title,
                    "body": body,
                    "data": dict(payload_data),
                    "categoryId": PUSH_CATEGORY_ID,
                    "mutableContent": True,
                }
                if normalized_delivery_id:
                    message["collapseId"] = normalized_delivery_id
                    message["tag"] = normalized_delivery_id
                messages.append(message)
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
                logger.error("Expo push request-level error", extra={"provider_payload": payload})
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

            accepted_tickets: list[AcceptedPushTicket] = []
            for token, ticket in zip(token_chunk, tickets, strict=True):
                if not isinstance(ticket, dict):
                    all_deliverable_accepted = False
                    continue
                status = ticket.get("status")
                receipt_id = ticket.get("id")
                if status == "ok" and isinstance(receipt_id, str) and receipt_id:
                    row = token_rows[token]
                    accepted_tickets.append(
                        AcceptedPushTicket(
                            receipt_id=receipt_id,
                            push_token_id=row.id,
                            token=token,
                            delivery_id=normalized_delivery_id,
                        )
                    )
                    continue
                error_code = _ticket_error_code(ticket)
                if status == "error" and error_code == "DeviceNotRegistered":
                    permanently_invalid.add(token)
                    continue
                logger.warning(
                    "Expo push ticket rejected",
                    extra={
                        "error_code": error_code,
                        "provider_message": ticket.get("message"),
                    },
                )
                all_deliverable_accepted = False

            if accepted_tickets:
                try:
                    await record_accepted_tickets_persistently(accepted_tickets)
                except Exception as exc:
                    logger.exception(
                        "Expo ticket accepted but receipt ledger persistence failed",
                        extra={"ticket_count": len(accepted_tickets)},
                    )
                    all_deliverable_accepted = False
                    break

    await _remove_tokens_persistently(permanently_invalid)
    return all_deliverable_accepted
