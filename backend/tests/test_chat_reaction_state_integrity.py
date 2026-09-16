"""P0 #316: chat reactions are replay-safe state assignments, never toggles."""

import pytest
from fastapi import HTTPException

from app.api.v1 import chat_reaction_integrity as reaction_api
from app.api.v1.chat_reaction_integrity import ReactionStateBody, set_message_reaction_state
from app.api.v1.router import api_router
from app.models.entities import ChatMessage, ChatMessageType, ChatThread, Project, User, UserRole

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008201", role=UserRole.customer, full_name="Reaction customer")
    outsider = User(phone="+79990008202", role=UserRole.customer, full_name="Reaction outsider")
    db.add_all([customer, outsider])
    await db.flush()
    project = Project(
        name="Reaction replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(project)
    await db.flush()
    thread = ChatThread(
        project_id=project.id,
        title="Reaction thread",
        topic="general",
        created_by=customer.id,
    )
    db.add(thread)
    await db.flush()
    message = ChatMessage(
        thread_id=thread.id,
        user_id=customer.id,
        author_role="customer",
        message_type=ChatMessageType.text,
        text="Проверка реакции",
    )
    db.add(message)
    await db.commit()
    return customer, outsider, project, thread, message


async def test_reaction_same_desired_state_is_noop_on_replay(db, monkeypatch):
    customer, _, project, thread, message = await _fixture(db)
    broadcasts: list[dict] = []

    async def fake_broadcast(thread_id: str, payload: dict):
        broadcasts.append({"thread_id": thread_id, "payload": payload})

    monkeypatch.setattr(reaction_api, "broadcast", fake_broadcast)

    first = await set_message_reaction_state(
        project.id,
        thread.id,
        message.id,
        ReactionStateBody(emoji="👍", reacted=True),
        user=customer,
        db=db,
    )
    replay = await set_message_reaction_state(
        project.id,
        thread.id,
        message.id,
        ReactionStateBody(emoji="👍", reacted=True),
        user=customer,
        db=db,
    )

    assert first["changed"] is True
    assert replay["changed"] is False
    assert first["reactions"]["👍"] == [customer.id]
    assert replay["reactions"]["👍"] == [customer.id]
    assert len(broadcasts) == 1

    removed = await set_message_reaction_state(
        project.id,
        thread.id,
        message.id,
        ReactionStateBody(emoji="👍", reacted=False),
        user=customer,
        db=db,
    )
    removed_replay = await set_message_reaction_state(
        project.id,
        thread.id,
        message.id,
        ReactionStateBody(emoji="👍", reacted=False),
        user=customer,
        db=db,
    )

    assert removed["changed"] is True
    assert removed_replay["changed"] is False
    assert "👍" not in removed["reactions"]
    assert "👍" not in removed_replay["reactions"]
    assert len(broadcasts) == 2


async def test_reaction_requires_exact_thread_access(db):
    customer, outsider, project, thread, message = await _fixture(db)
    assert customer.id != outsider.id

    with pytest.raises(HTTPException) as exc_info:
        await set_message_reaction_state(
            project.id,
            thread.id,
            message.id,
            ReactionStateBody(emoji="✅", reacted=True),
            user=outsider,
            db=db,
        )
    assert exc_info.value.status_code == 403


def test_reaction_runtime_has_one_canonical_state_handler():
    path = "/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/react"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("chat_reaction_integrity")
