"""Atomic idempotency helpers for client-originated create requests."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.client_write_request import ClientWriteRequest


class IdempotencyConflict(ValueError):
    """The same request ID was reused with a different canonical payload."""


def canonical_payload_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def _find_request(
    db: AsyncSession,
    *,
    scope: str,
    project_id: str,
    user_id: str,
    request_id: str,
) -> ClientWriteRequest | None:
    result = await db.execute(
        select(ClientWriteRequest).where(
            ClientWriteRequest.scope == scope,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.user_id == user_id,
            ClientWriteRequest.request_id == request_id,
        )
    )
    return result.scalar_one_or_none()


def _assert_payload(existing: ClientWriteRequest, expected_hash: str) -> None:
    if existing.payload_hash != expected_hash:
        raise IdempotencyConflict("idempotency_conflict")


async def replay_entity_id(
    db: AsyncSession,
    *,
    scope: str,
    project_id: str,
    user_id: str,
    request_id: str | None,
    payload: dict[str, Any],
) -> str | None:
    if not request_id:
        return None
    existing = await _find_request(
        db,
        scope=scope,
        project_id=project_id,
        user_id=user_id,
        request_id=request_id,
    )
    if not existing:
        return None
    _assert_payload(existing, canonical_payload_hash(payload))
    return existing.entity_id


async def commit_client_write(
    db: AsyncSession,
    *,
    scope: str,
    project_id: str,
    user_id: str,
    request_id: str | None,
    payload: dict[str, Any],
    entity_id: str,
) -> tuple[bool, str]:
    """Commit the pending entity/side effects and its request ledger atomically.

    Returns ``(created, entity_id)``. If another transaction won the same
    request ID, this transaction is rolled back and the winner's entity ID is
    returned. A reused ID with another payload raises ``IdempotencyConflict``.
    """
    if not request_id:
        await db.commit()
        return True, entity_id

    expected_hash = canonical_payload_hash(payload)
    db.add(
        ClientWriteRequest(
            scope=scope,
            project_id=project_id,
            user_id=user_id,
            request_id=request_id,
            payload_hash=expected_hash,
            entity_id=entity_id,
        )
    )
    try:
        await db.commit()
        return True, entity_id
    except IntegrityError:
        await db.rollback()
        existing = await _find_request(
            db,
            scope=scope,
            project_id=project_id,
            user_id=user_id,
            request_id=request_id,
        )
        if not existing:
            raise
        _assert_payload(existing, expected_hash)
        return False, existing.entity_id
