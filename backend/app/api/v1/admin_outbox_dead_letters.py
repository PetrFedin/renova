"""Platform-admin API for inspecting and recovering poisoned outbox events."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.db.session import get_db
from app.models.entities import User
from app.services.outbox_dead_letter_service import (
    DeadLetterConflict,
    DeadLetterNotFound,
    claim_dead_letter,
    dead_letter_history,
    get_dead_letter,
    list_dead_letters,
    release_dead_letter,
    replay_dead_letter,
)

router = APIRouter(prefix="/outbox/dead-letters", tags=["admin-outbox"])


class ClaimCommand(BaseModel):
    claim_token: str = Field(min_length=1, max_length=64)


class ReplayCommand(ClaimCommand):
    dispatch_now: bool = True


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, DeadLetterNotFound):
        raise HTTPException(404, detail={"code": exc.code}) from exc
    if isinstance(exc, DeadLetterConflict):
        detail: dict[str, object] = {"code": exc.code}
        if exc.context:
            detail["context"] = exc.context
        raise HTTPException(409, detail=detail) from exc
    raise exc


@router.get("")
async def dead_letter_index(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    event_type: str | None = Query(None, min_length=1, max_length=64),
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await list_dead_letters(
        db,
        admin_user_id=user.id,
        limit=limit,
        offset=offset,
        event_type=event_type,
    )


@router.get("/{outbox_id}")
async def dead_letter_detail(
    outbox_id: str,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_dead_letter(
            db,
            outbox_id=outbox_id,
            admin_user_id=user.id,
        )
    except (DeadLetterNotFound, DeadLetterConflict) as exc:
        _raise_service_error(exc)


@router.post("/{outbox_id}/claim")
async def dead_letter_claim(
    outbox_id: str,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await claim_dead_letter(
            db,
            outbox_id=outbox_id,
            admin_user_id=user.id,
        )
    except (DeadLetterNotFound, DeadLetterConflict) as exc:
        _raise_service_error(exc)


@router.post("/{outbox_id}/release")
async def dead_letter_release(
    outbox_id: str,
    command: ClaimCommand,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await release_dead_letter(
            db,
            outbox_id=outbox_id,
            admin_user_id=user.id,
            claim_token=command.claim_token,
        )
    except (DeadLetterNotFound, DeadLetterConflict) as exc:
        _raise_service_error(exc)


@router.post("/{outbox_id}/replay")
async def dead_letter_replay(
    outbox_id: str,
    command: ReplayCommand,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await replay_dead_letter(
            db,
            outbox_id=outbox_id,
            admin_user_id=user.id,
            claim_token=command.claim_token,
            dispatch_now=command.dispatch_now,
        )
    except (DeadLetterNotFound, DeadLetterConflict) as exc:
        _raise_service_error(exc)


@router.get("/{outbox_id}/history")
async def dead_letter_audit_history(
    outbox_id: str,
    limit: int = Query(50, ge=1, le=100),
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return {
            "items": await dead_letter_history(
                db,
                outbox_id=outbox_id,
                limit=limit,
            )
        }
    except DeadLetterNotFound as exc:
        _raise_service_error(exc)
