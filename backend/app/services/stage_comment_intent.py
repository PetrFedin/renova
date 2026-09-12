"""Replay-safe stage-comment creation for #398 / parent #316."""
from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import StageComment
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "stage.comment.create"
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


def _validate_request_id(value: str) -> None:
    if not isinstance(value, str) or not _REQUEST_ID.fullmatch(value):
        raise ValueError("stage_comment_request_id_invalid")


def _validate_text(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 2000:
        raise ValueError("stage_comment_text_invalid")
    return value


async def _replay_comment(db: AsyncSession, *, stage_id: str, comment_id: str) -> StageComment:
    comment = await db.get(StageComment, comment_id)
    if comment is None or comment.stage_id != stage_id:
        raise RuntimeError("stage_comment_replay_corrupt")
    return comment


async def create_comment(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    user_id: str,
    author_role: str,
    client_request_id: str,
    text: str,
) -> StageComment:
    """Create one comment per explicit user intent.

    Stage/project ACL and binding are checked by the route immediately before
    calling this service. The stage id participates in the canonical payload so
    one request id cannot be silently retargeted to another stage.
    """
    _validate_request_id(client_request_id)
    clean_text = _validate_text(text)
    payload = {"stage_id": stage_id, "text": clean_text}

    replay = await replay_entity_id(
        db,
        scope=SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay:
        return await _replay_comment(db, stage_id=stage_id, comment_id=replay)

    try:
        comment = StageComment(
            stage_id=stage_id,
            user_id=user_id,
            author_role=author_role,
            text=clean_text,
        )
        db.add(comment)
        await db.flush()
        created, entity_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=comment.id,
        )
        if not created:
            return await _replay_comment(db, stage_id=stage_id, comment_id=entity_id)
        await db.refresh(comment)
        return comment
    except BaseException:
        await db.rollback()
        raise
