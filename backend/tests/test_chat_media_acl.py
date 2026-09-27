"""Chat attachment media ACL (#453): bind chat-media/legacy chat/* keys to
canonical chat thread authority (project customer/contractor or an active
thread-only participant), mirroring chat_acl.require_chat_access exactly.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.entities import ChatMessage, ChatMessageType, ChatThread, ChatThreadParticipant, Project, User, UserRole
from app.services.chat_media_acl import (
    assert_chat_media_access,
    is_chat_media_key,
    is_legacy_chat_media_key,
    parse_chat_media_key,
)


def test_parse_chat_media_key_canonical():
    k = parse_chat_media_key("chat-media/thread-abc/photo.jpg")
    assert k is not None
    assert k.thread_id == "thread-abc"
    assert k.relative_path == "photo.jpg"


def test_parse_rejects_non_chat_media_and_traversal():
    assert parse_chat_media_key("photos/abc.jpg") is None
    assert parse_chat_media_key("chat-media/") is None
    assert parse_chat_media_key("chat-media/only-thread") is None
    assert parse_chat_media_key("chat-media/thread/../x/file.txt") is None


def test_legacy_key_detection():
    assert is_legacy_chat_media_key("chat/abcdef123.jpg") is True
    assert is_legacy_chat_media_key("chat/") is False
    assert is_legacy_chat_media_key("chat-media/thread/file.jpg") is False
    assert is_legacy_chat_media_key("photos/abc.jpg") is False


def test_is_chat_media_key():
    assert is_chat_media_key("chat-media/thread-abc/photo.jpg") is True
    assert is_chat_media_key("chat/legacy123.jpg") is True
    assert is_chat_media_key("documents/proj/file.txt") is False
    assert is_chat_media_key("photos/abc.jpg") is False


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@pytest.mark.asyncio
async def test_canonical_chat_media_acl_matrix():
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer = User(id="cma-customer", phone="+79990001001", role=UserRole.customer, full_name="Customer")
            contractor = User(id="cma-contractor", phone="+79990001002", role=UserRole.contractor, full_name="Contractor")
            invited = User(id="cma-invited", phone="+79990001003", role=UserRole.contractor, full_name="Invited", profile_code="CMA003")
            outsider = User(id="cma-outsider", phone="+79990001004", role=UserRole.contractor, full_name="Outsider", profile_code="CMA004")

            project = Project(id="cma-project", name="Media ACL", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id)
            invited_thread = ChatThread(id="cma-thread-invited", project_id=project.id, title="Invited", created_by=customer.id)
            sibling_thread = ChatThread(id="cma-thread-sibling", project_id=project.id, title="Sibling", created_by=customer.id)

            db.add_all([customer, contractor, invited, outsider, project, invited_thread, sibling_thread])
            await db.flush()

            participant = ChatThreadParticipant(
                id="cma-participant",
                thread_id=invited_thread.id,
                user_id=invited.id,
                profile_code=invited.profile_code,
                invited_by=customer.id,
                status="active",
            )
            db.add(participant)
            await db.commit()

            key = f"chat-media/{invited_thread.id}/photo.jpg"

            # Active thread-only participant reads media for the invited thread.
            resolved = await assert_chat_media_access(db, invited, key)
            assert resolved == invited_thread.id

            # Same participant gets privacy 404 for sibling-thread media.
            with pytest.raises(HTTPException) as sibling_exc:
                await assert_chat_media_access(db, invited, f"chat-media/{sibling_thread.id}/photo.jpg")
            assert sibling_exc.value.status_code == 404

            # Unrelated user gets privacy 404.
            with pytest.raises(HTTPException) as outsider_exc:
                await assert_chat_media_access(db, outsider, key)
            assert outsider_exc.value.status_code == 404

            # Project customer / contractor keep the broader canonical chat authority.
            assert await assert_chat_media_access(db, customer, key) == invited_thread.id
            assert await assert_chat_media_access(db, contractor, key) == invited_thread.id

            # Revoked thread-only participant loses access immediately.
            participant.status = "removed"
            await db.commit()
            with pytest.raises(HTTPException) as revoked_exc:
                await assert_chat_media_access(db, invited, key)
            assert revoked_exc.value.status_code == 404
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_legacy_chat_media_key_resolution():
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer = User(id="lgc-customer", phone="+79990002001", role=UserRole.customer, full_name="Customer")
            contractor = User(id="lgc-contractor", phone="+79990002002", role=UserRole.contractor, full_name="Contractor")
            invited = User(id="lgc-invited", phone="+79990002003", role=UserRole.contractor, full_name="Invited", profile_code="LGC003")
            outsider = User(id="lgc-outsider", phone="+79990002004", role=UserRole.contractor, full_name="Outsider", profile_code="LGC004")

            project = Project(id="lgc-project", name="Legacy Media ACL", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id)
            thread_a = ChatThread(id="lgc-thread-a", project_id=project.id, title="A", created_by=customer.id)
            thread_b = ChatThread(id="lgc-thread-b", project_id=project.id, title="B", created_by=customer.id)

            db.add_all([customer, contractor, invited, outsider, project, thread_a, thread_b])
            await db.flush()

            db.add(
                ChatThreadParticipant(
                    id="lgc-participant",
                    thread_id=thread_a.id,
                    user_id=invited.id,
                    profile_code=invited.profile_code,
                    invited_by=customer.id,
                    status="active",
                )
            )

            referenced_key = "chat/referenced123.jpg"
            unreferenced_key = "chat/unreferenced456.jpg"
            ambiguous_key = "chat/ambiguous789.jpg"

            db.add(ChatMessage(id="lgc-msg-a", thread_id=thread_a.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.photo, storage_key=referenced_key))
            # Ambiguous key referenced by messages in two different threads must fail closed.
            db.add(ChatMessage(id="lgc-msg-amb-1", thread_id=thread_a.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.photo, storage_key=ambiguous_key))
            db.add(ChatMessage(id="lgc-msg-amb-2", thread_id=thread_b.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.photo, storage_key=ambiguous_key))
            await db.commit()

            # Legacy referenced key remains accessible only through its current owning-thread authority.
            assert await assert_chat_media_access(db, invited, referenced_key) == thread_a.id

            with pytest.raises(HTTPException) as outsider_exc:
                await assert_chat_media_access(db, outsider, referenced_key)
            assert outsider_exc.value.status_code == 404

            # Unreferenced key fails closed (404), not treated as public/open.
            with pytest.raises(HTTPException) as unreferenced_exc:
                await assert_chat_media_access(db, invited, unreferenced_key)
            assert unreferenced_exc.value.status_code == 404

            # Ambiguous cross-thread key fails closed (404) even for a project principal.
            with pytest.raises(HTTPException) as ambiguous_exc:
                await assert_chat_media_access(db, customer, ambiguous_key)
            assert ambiguous_exc.value.status_code == 404
    finally:
        await engine.dispose()
