from __future__ import annotations

from datetime import datetime
import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register the canonical ORM metadata
from app.db.base import Base
from app.models.entities import (
    ChatThread,
    ChatThreadParticipant,
    ChatThreadRead,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
from app.services import chat_message_mutation
from app.services import chat_service
from app.services import outbox_service


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(db):
    customer = User(
        id="11111111-1111-1111-1111-111111111111",
        phone="+79990000001",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="22222222-2222-2222-2222-222222222222",
        phone="+79990000002",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    invited = User(
        id="33333333-3333-3333-3333-333333333333",
        phone="+79990000003",
        role=UserRole.contractor,
        full_name="Invited specialist",
        profile_code="INV003",
    )
    project = Project(
        id="44444444-4444-4444-4444-444444444444",
        name="Participant delivery",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="55555555-5555-5555-5555-555555555555",
        project_id=project.id,
        title="Kitchen",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, invited, project, thread])
    await db.commit()
    return customer, contractor, invited, project, thread


@pytest.mark.asyncio
async def test_atomic_message_notifies_and_unarchives_exact_active_participant_once(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer, contractor, invited, _project, thread = await _seed(db)
            original_cursor = datetime(2026, 1, 2, 9, 30, 0)
            db.add(
                ChatThreadParticipant(
                    id="atomic-participant-0001",
                    thread_id=thread.id,
                    user_id=invited.id,
                    profile_code=invited.profile_code,
                    invited_by=customer.id,
                    status="active",
                )
            )
            db.add(
                ChatThreadRead(
                    id="atomic-participant-read-0001",
                    thread_id=thread.id,
                    user_id=invited.id,
                    last_read_at=original_cursor,
                    is_archived=True,
                )
            )
            await db.commit()

            dispatched_recipients: list[set[str]] = []

            async def _no_inline(*_args, **_kwargs):
                return 0

            async def _capture_broadcast(*, recipient_ids: set[str], **_kwargs):
                dispatched_recipients.append(set(recipient_ids))

            monkeypatch.setattr(
                chat_message_mutation.outbox_inline_dispatch,
                "dispatch_best_effort",
                _no_inline,
            )
            monkeypatch.setattr(
                chat_message_mutation,
                "_broadcast_after_commit",
                _capture_broadcast,
            )

            first = await chat_message_mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="participant-atomic-request-0001",
                text="Atomic participant delivery",
            )
            replay = await chat_message_mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="participant-atomic-request-0001",
                text="Atomic participant delivery",
            )
            assert replay.id == first.id

            state = await db.get(ChatThreadRead, "atomic-participant-read-0001")
            assert state is not None
            assert state.is_archived is False
            assert state.last_read_at == original_cursor

            events = (
                await db.execute(
                    select(DomainOutbox).where(
                        DomainOutbox.aggregate_id == first.id,
                        DomainOutbox.event_type == outbox_service.NOTIFICATION_EVENT,
                    )
                )
            ).scalars().all()
            payloads = [json.loads(event.payload_json) for event in events]
            assert {payload["user_id"] for payload in payloads} == {
                contractor.id,
                invited.id,
            }
            assert all(payload["return_to"] == "/(contractor)/(tabs)/chat" for payload in payloads)
            assert customer.id not in {payload["user_id"] for payload in payloads}
            assert dispatched_recipients == [{contractor.id, invited.id}]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_new_message_notifies_project_principal_and_exact_active_participant(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer, contractor, invited, project, thread = await _seed(db)
            db.add(
                ChatThreadParticipant(
                    id="66666666-6666-6666-6666-666666666666",
                    thread_id=thread.id,
                    user_id=invited.id,
                    profile_code=invited.profile_code,
                    invited_by=customer.id,
                    status="active",
                )
            )
            await db.commit()

            notifications: list[dict] = []
            inbox_broadcasts: list[tuple[str, dict]] = []

            async def _notify(_db, **kwargs):
                notifications.append(kwargs)
                return None

            async def _broadcast(_thread_id, _payload):
                return None

            async def _broadcast_inbox(user_id, payload):
                inbox_broadcasts.append((user_id, payload))

            monkeypatch.setattr(chat_service.notif_svc, "notify", _notify)
            from app.api.v1 import ws

            monkeypatch.setattr(ws, "broadcast", _broadcast)
            monkeypatch.setattr(ws, "broadcast_inbox", _broadcast_inbox)

            await chat_service.send_message(
                db,
                thread,
                customer.id,
                customer.role.value,
                "Hello exact participants",
            )

            by_user = {item["user_id"]: item for item in notifications}
            assert set(by_user) == {contractor.id, invited.id}
            assert customer.id not in by_user
            assert by_user[contractor.id]["return_to"] == "/(contractor)/(tabs)/chat"
            assert by_user[invited.id]["return_to"] == "/(contractor)/(tabs)/chat"
            assert {user_id for user_id, _payload in inbox_broadcasts} == {
                contractor.id,
                invited.id,
            }
            assert all(
                payload["thread_id"] == thread.id
                and payload["project_id"] == project.id
                for _user_id, payload in inbox_broadcasts
            )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pending_or_deleted_participant_is_not_message_recipient(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer, contractor, invited, _project, thread = await _seed(db)
            invited.deleted_at = invited.created_at
            db.add(
                ChatThreadParticipant(
                    id="77777777-7777-7777-7777-777777777777",
                    thread_id=thread.id,
                    user_id=invited.id,
                    profile_code=invited.profile_code,
                    invited_by=customer.id,
                    status="active",
                )
            )
            db.add(
                ChatThreadParticipant(
                    id="88888888-8888-8888-8888-888888888888",
                    thread_id=thread.id,
                    phone="+79990000004",
                    invited_by=customer.id,
                    status="pending",
                )
            )
            await db.commit()

            notified: list[str] = []

            async def _notify(_db, **kwargs):
                notified.append(kwargs["user_id"])
                return None

            async def _noop(*_args, **_kwargs):
                return None

            monkeypatch.setattr(chat_service.notif_svc, "notify", _notify)
            from app.api.v1 import ws

            monkeypatch.setattr(ws, "broadcast", _noop)
            monkeypatch.setattr(ws, "broadcast_inbox", _noop)

            await chat_service.send_message(
                db,
                thread,
                customer.id,
                customer.role.value,
                "Do not notify inactive identities",
            )

            assert notified == [contractor.id]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_registered_invite_notification_return_path_matches_target_role(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer, _contractor, invited, _project, thread = await _seed(db)

            async def _no_inline(*_args, **_kwargs):
                return 0

            monkeypatch.setattr(
                chat_service.outbox_inline_dispatch,
                "dispatch_best_effort",
                _no_inline,
            )
            result = await chat_service.invite_participant(
                db,
                thread,
                customer,
                profile_code=invited.profile_code,
            )
            notification_event = (
                await db.execute(
                    select(DomainOutbox).where(
                        DomainOutbox.aggregate_id == result["id"],
                        DomainOutbox.event_type == outbox_service.NOTIFICATION_EVENT,
                    )
                )
            ).scalar_one()
            payload = json.loads(notification_event.payload_json)

            assert result["delivery_channel"] == "in_app"
            assert payload["user_id"] == invited.id
            assert payload["return_to"] == "/(contractor)/(tabs)/chat"
    finally:
        await engine.dispose()
