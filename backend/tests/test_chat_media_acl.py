from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    Project,
    User,
    UserRole,
)
from app.services import chat_media_acl


async def seed_chat_media(db):
    customer = User(
        id="chat-media-customer",
        phone="+79990002001",
        role=UserRole.customer,
    )
    contractor = User(
        id="chat-media-contractor",
        phone="+79990002002",
        role=UserRole.contractor,
    )
    invited = User(
        id="chat-media-invited",
        phone="+79990002003",
        role=UserRole.contractor,
        profile_code="CMI003",
    )
    outsider = User(
        id="chat-media-outsider",
        phone="+79990002004",
        role=UserRole.contractor,
        profile_code="CMO004",
    )
    project = Project(
        id="chat-media-project",
        name="Chat media ACL",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    invited_thread = ChatThread(
        id="chat-media-thread-invited",
        project_id=project.id,
        title="Invited media thread",
        created_by=customer.id,
    )
    sibling_thread = ChatThread(
        id="chat-media-thread-sibling",
        project_id=project.id,
        title="Sibling media thread",
        created_by=customer.id,
    )
    db.add_all(
        [customer, contractor, invited, outsider, project, invited_thread, sibling_thread]
    )
    await db.flush()
    participant = ChatThreadParticipant(
        id="chat-media-participant",
        thread_id=invited_thread.id,
        user_id=invited.id,
        profile_code=invited.profile_code,
        invited_by=customer.id,
        status="active",
    )
    db.add(participant)
    await db.commit()
    return {
        "customer": customer,
        "contractor": contractor,
        "invited": invited,
        "outsider": outsider,
        "project": project,
        "invited_thread": invited_thread,
        "sibling_thread": sibling_thread,
        "participant": participant,
    }


def test_chat_media_key_parser_is_thread_scoped_and_fail_closed():
    parsed = chat_media_acl.parse_chat_media_key(
        "chat-media/chat-media-thread-invited/blob.jpg"
    )
    assert parsed is not None
    assert parsed.thread_id == "chat-media-thread-invited"
    assert parsed.relative_path == "blob.jpg"
    assert chat_media_acl.parse_chat_media_key("chat/legacy.jpg") is None
    assert chat_media_acl.parse_chat_media_key("chat-media/thread-only") is None
    assert chat_media_acl.parse_chat_media_key("chat-media/thread/../x") is None


@pytest.mark.asyncio
async def test_thread_only_participant_can_read_only_invited_chat_media(db):
    data = await seed_chat_media(db)
    invited = data["invited"]
    invited_thread = data["invited_thread"]
    sibling_thread = data["sibling_thread"]
    outsider = data["outsider"]

    own_key = f"chat-media/{invited_thread.id}/photo.jpg"
    parsed = await chat_media_acl.assert_chat_media_access(db, invited, own_key)
    assert parsed.thread_id == invited_thread.id

    with pytest.raises(HTTPException) as sibling_denied:
        await chat_media_acl.assert_chat_media_access(
            db,
            invited,
            f"chat-media/{sibling_thread.id}/photo.jpg",
        )
    assert sibling_denied.value.status_code == 404

    with pytest.raises(HTTPException) as outsider_denied:
        await chat_media_acl.assert_chat_media_access(db, outsider, own_key)
    assert outsider_denied.value.status_code == 404


@pytest.mark.asyncio
async def test_revoked_thread_participant_loses_media_access_immediately(db):
    data = await seed_chat_media(db)
    invited = data["invited"]
    thread = data["invited_thread"]
    participant = data["participant"]
    key = f"chat-media/{thread.id}/photo.jpg"

    assert (await chat_media_acl.assert_chat_media_access(db, invited, key)).thread_id == thread.id

    participant.status = "revoked"
    await db.commit()

    with pytest.raises(HTTPException) as denied:
        await chat_media_acl.assert_chat_media_access(db, invited, key)
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_project_customer_and_assigned_contractor_follow_existing_chat_authority(db):
    data = await seed_chat_media(db)
    thread = data["invited_thread"]
    key = f"chat-media/{thread.id}/photo.jpg"

    assert (
        await chat_media_acl.assert_chat_media_access(db, data["customer"], key)
    ).thread_id == thread.id
    assert (
        await chat_media_acl.assert_chat_media_access(db, data["contractor"], key)
    ).thread_id == thread.id


@pytest.mark.asyncio
async def test_legacy_chat_key_requires_one_owning_thread_and_current_access(db):
    data = await seed_chat_media(db)
    invited = data["invited"]
    outsider = data["outsider"]
    invited_thread = data["invited_thread"]
    sibling_thread = data["sibling_thread"]
    legacy_key = "chat/legacy-photo.jpg"

    db.add(
        ChatMessage(
            id="legacy-chat-message",
            thread_id=invited_thread.id,
            user_id=data["customer"].id,
            author_role="customer",
            message_type=ChatMessageType.photo,
            text="Legacy photo",
            storage_key=legacy_key,
            image_url=f"/api/v1/media/{legacy_key}",
        )
    )
    await db.commit()

    assert await chat_media_acl.assert_legacy_chat_media_access(
        db, invited, legacy_key
    ) == invited_thread.id

    with pytest.raises(HTTPException) as outsider_denied:
        await chat_media_acl.assert_legacy_chat_media_access(db, outsider, legacy_key)
    assert outsider_denied.value.status_code == 404

    with pytest.raises(HTTPException) as unreferenced:
        await chat_media_acl.assert_legacy_chat_media_access(
            db, invited, "chat/unreferenced.jpg"
        )
    assert unreferenced.value.status_code == 404

    db.add(
        ChatMessage(
            id="legacy-chat-message-sibling",
            thread_id=sibling_thread.id,
            user_id=data["customer"].id,
            author_role="customer",
            message_type=ChatMessageType.photo,
            text="Ambiguous legacy photo",
            storage_key=legacy_key,
            image_url=f"/api/v1/media/{legacy_key}",
        )
    )
    await db.commit()

    with pytest.raises(HTTPException) as ambiguous:
        await chat_media_acl.assert_legacy_chat_media_access(db, invited, legacy_key)
    assert ambiguous.value.status_code == 404


@pytest.mark.asyncio
async def test_revoked_participant_also_loses_legacy_attachment_access(db):
    data = await seed_chat_media(db)
    legacy_key = "chat/revoked-legacy.jpg"
    db.add(
        ChatMessage(
            id="legacy-revoked-message",
            thread_id=data["invited_thread"].id,
            user_id=data["customer"].id,
            author_role="customer",
            message_type=ChatMessageType.photo,
            text="Legacy",
            storage_key=legacy_key,
            image_url=f"/api/v1/media/{legacy_key}",
        )
    )
    await db.commit()
    assert await chat_media_acl.assert_legacy_chat_media_access(
        db, data["invited"], legacy_key
    ) == data["invited_thread"].id

    data["participant"].status = "revoked"
    await db.commit()
    with pytest.raises(HTTPException) as denied:
        await chat_media_acl.assert_legacy_chat_media_access(
            db, data["invited"], legacy_key
        )
    assert denied.value.status_code == 404
