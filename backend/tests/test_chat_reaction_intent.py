"""P0 #384: queued chat reaction intents execute exactly once."""
from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatMessage
from app.services import chat_reaction_intent as reactions
from app.services.client_write_idempotency import IdempotencyConflict
from test_chat_business_commands import seed


async def _request_count(db, project_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(ClientWriteRequest)
            .where(
                ClientWriteRequest.scope == reactions.REACTION_SCOPE,
                ClientWriteRequest.project_id == project_id,
            )
        )
    )


@pytest.mark.asyncio
async def test_response_loss_replay_does_not_toggle_reaction_twice(db):
    s = await seed(db)
    args = dict(
        project_id=s.project,
        thread_id=s.thread,
        message_id=s.source,
        user_id=s.contractor,
        client_request_id="reaction-response-loss-001",
        emoji="🔥",
    )

    first = await reactions.apply_reaction_intent(db, **args)
    assert first["🔥"] == [s.contractor]

    # Simulate the committed response being lost and the exact intent replaying.
    second = await reactions.apply_reaction_intent(db, **args)
    assert second["🔥"] == [s.contractor]
    message = await db.get(ChatMessage, s.source)
    meta = json.loads(message.meta_json)
    assert meta["reactions"]["🔥"] == [s.contractor]
    assert meta["reactions"]["ok"] == [s.customer]
    assert await _request_count(db, s.project) == 1


@pytest.mark.asyncio
async def test_second_real_tap_has_new_identity_and_can_remove_reaction(db):
    s = await seed(db)
    common = dict(
        project_id=s.project,
        thread_id=s.thread,
        message_id=s.source,
        user_id=s.contractor,
        emoji="👍",
    )
    first = await reactions.apply_reaction_intent(
        db, client_request_id="reaction-first-user-intent", **common,
    )
    assert first["👍"] == [s.contractor]

    second = await reactions.apply_reaction_intent(
        db, client_request_id="reaction-second-user-intent", **common,
    )
    assert "👍" not in second
    assert await _request_count(db, s.project) == 2


@pytest.mark.asyncio
async def test_same_key_changed_emoji_conflicts_without_second_toggle(db):
    s = await seed(db)
    common = dict(
        project_id=s.project,
        thread_id=s.thread,
        message_id=s.source,
        user_id=s.contractor,
        client_request_id="reaction-conflict-intent-001",
    )
    await reactions.apply_reaction_intent(db, emoji="🔥", **common)

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await reactions.apply_reaction_intent(db, emoji="❤️", **common)

    meta = json.loads((await db.get(ChatMessage, s.source)).meta_json)
    assert meta["reactions"]["🔥"] == [s.contractor]
    assert "❤️" not in meta["reactions"]
    assert meta["reactions"]["ok"] == [s.customer]
    assert await _request_count(db, s.project) == 1


@pytest.mark.asyncio
async def test_reaction_preserves_unrelated_message_metadata(db):
    s = await seed(db)
    message = await db.get(ChatMessage, s.source)
    message.meta_json = json.dumps(
        {
            "linked_task_id": "existing-work-order",
            "reactions": {"ok": [s.customer]},
            "custom": {"keep": True},
        }
    )
    await db.commit()

    await reactions.apply_reaction_intent(
        db,
        project_id=s.project,
        thread_id=s.thread,
        message_id=s.source,
        user_id=s.contractor,
        client_request_id="reaction-preserve-meta-001",
        emoji="✅",
    )

    meta = json.loads((await db.get(ChatMessage, s.source)).meta_json)
    assert meta["linked_task_id"] == "existing-work-order"
    assert meta["custom"] == {"keep": True}
    assert meta["reactions"]["ok"] == [s.customer]
    assert meta["reactions"]["✅"] == [s.contractor]
