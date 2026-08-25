from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - canonical deterministic ORM registry
from app.db.base import Base
from app.api.v1 import chats as chats_api
from app.models.entities import (
    ChatThread,
    ChatThreadParticipant,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
from app.models.outbox_runtime import SideEffectDelivery
from app.services import chat_invitation_delivery
from app.services import chat_participant_service as participant_svc
from app.services import chat_service as chat_svc
from app.services import otp_login_service
from app.services import outbox_dead_letter_service as dead_letter_svc
from app.services import outbox_service
from app.services.chat_acl import require_chat_access
from app.services.sms_service import (
    SmsDeliveryAmbiguous,
    SmsDeliveryRejected,
    SmsDeliveryResult,
    SmsDeliveryRetryable,
)


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_project(db):
    inviter = User(
        id="11111111-1111-1111-1111-111111111111",
        phone="+79990000001",
        role=UserRole.customer,
        full_name="Owner",
    )
    project = Project(
        id="22222222-2222-2222-2222-222222222222",
        name="Invite project",
        renovation_type="cosmetic",
        customer_id=inviter.id,
    )
    thread = ChatThread(
        id="33333333-3333-3333-3333-333333333333",
        project_id=project.id,
        title="Kitchen coordination",
        created_by=inviter.id,
    )
    sibling = ChatThread(
        id="44444444-4444-4444-4444-444444444444",
        project_id=project.id,
        title="Private sibling",
        created_by=inviter.id,
    )
    db.add_all([inviter, project, thread, sibling])
    await db.commit()
    return inviter, project, thread, sibling


async def _disable_inline_dispatch(monkeypatch):
    async def _noop(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(chat_svc.outbox_inline_dispatch, "dispatch_best_effort", _noop)


async def _sms_outbox(db, participant_id: str) -> DomainOutbox:
    return (
        await db.execute(
            select(DomainOutbox)
            .where(
                DomainOutbox.aggregate_id == participant_id,
                DomainOutbox.event_type == outbox_service.CHAT_INVITATION_SMS_EVENT,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_phone_invite_is_idempotent_and_outbox_contains_no_phone(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)

            first = await chat_svc.invite_participant(
                db, thread, inviter, phone="+7 999 000-00-02"
            )
            second = await chat_svc.invite_participant(
                db, thread, inviter, phone="+7 (999) 000-00-02"
            )

            assert first["id"] == second["id"]
            assert first["delivery_channel"] == "sms"
            assert first["delivery_status"] == "sms_queued"
            assert await db.scalar(
                select(func.count())
                .select_from(ChatThreadParticipant)
                .where(ChatThreadParticipant.thread_id == thread.id)
            ) == 1

            events = list(
                (
                    await db.execute(
                        select(DomainOutbox).where(DomainOutbox.aggregate_id == first["id"])
                    )
                ).scalars().all()
            )
            assert sorted(event.event_type for event in events) == [
                outbox_service.ACTIVITY_EVENT,
                outbox_service.CHAT_INVITATION_SMS_EVENT,
            ]
            sms_event = next(
                event
                for event in events
                if event.event_type == outbox_service.CHAT_INVITATION_SMS_EVENT
            )
            assert json.loads(sms_event.payload_json) == {"participant_id": first["id"]}
            assert "+79990000002" not in sms_event.payload_json
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_registered_phone_uses_in_app_delivery_not_sms(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            target = User(
                id="55555555-5555-5555-5555-555555555555",
                phone="+79990000002",
                role=UserRole.contractor,
                full_name="Invited",
            )
            db.add(target)
            await db.commit()
            await _disable_inline_dispatch(monkeypatch)

            result = await chat_svc.invite_participant(
                db, thread, inviter, phone="+7 999 000-00-02"
            )
            participant = await db.get(ChatThreadParticipant, result["id"])
            events = list(
                (
                    await db.execute(
                        select(DomainOutbox).where(DomainOutbox.aggregate_id == result["id"])
                    )
                ).scalars().all()
            )

            assert participant is not None
            assert participant.user_id == target.id
            assert participant.status == "active"
            assert result["delivery_channel"] == "in_app"
            assert result["delivery_status"] == "in_app_queued"
            event_types = {event.event_type for event in events}
            assert outbox_service.NOTIFICATION_EVENT in event_types
            assert outbox_service.CHAT_INVITATION_SMS_EVENT not in event_types
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pending_phone_invite_activates_and_stays_thread_scoped(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, project, thread, sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            user = User(
                id="66666666-6666-6666-6666-666666666666",
                phone="+79990000002",
                role=UserRole.contractor,
                full_name="New user",
            )
            db.add(user)
            await db.flush()

            assert await participant_svc.activate_pending_phone_invitations(db, user) == 1
            assert await participant_svc.activate_pending_phone_invitations(db, user) == 0
            await db.commit()

            participant = await db.get(ChatThreadParticipant, invite["id"])
            assert participant is not None
            assert participant.user_id == user.id
            assert participant.status == "active"

            _project, allowed_thread = await require_chat_access(
                db,
                project.id,
                thread.id,
                user,
                write=True,
                allow_participant=True,
            )
            assert allowed_thread.id == thread.id

            with pytest.raises(HTTPException) as no_project_authority:
                await require_chat_access(
                    db,
                    project.id,
                    thread.id,
                    user,
                    write=True,
                    allow_participant=False,
                )
            assert no_project_authority.value.status_code == 403

            with pytest.raises(HTTPException) as sibling_denied:
                await require_chat_access(
                    db,
                    project.id,
                    sibling.id,
                    user,
                    write=True,
                    allow_participant=True,
                )
            assert sibling_denied.value.status_code == 403

            inbox = await participant_svc.participant_inbox(
                db,
                user_id=user.id,
                exclude_project_ids=set(),
            )
            assert [item["id"] for item in inbox] == [thread.id]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_provider_acceptance_records_evidence_once(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            calls = 0

            async def _accepted(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                return SmsDeliveryResult(delivered=True, provider_id="SM1234567890")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _accepted)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="success")
            row = await _sms_outbox(db, invite["id"])
            payload = json.loads(row.payload_json)
            marker = (
                await db.execute(
                    select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == row.id)
                )
            ).scalar_one()

            assert calls == 1
            assert row.processed_at is not None
            assert payload["provider_message_id"] == "SM1234567890"
            assert payload["delivery_outcome"] == "provider_accepted"
            assert marker.delivered_at is not None
            assert chat_invitation_delivery.delivery_status(row) == "sms_provider_accepted"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_registration_before_worker_send_skips_sms(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            user = User(
                id="77777777-7777-7777-7777-777777777777",
                phone="+79990000002",
                role=UserRole.contractor,
            )
            db.add(user)
            await db.flush()
            await participant_svc.activate_pending_phone_invitations(db, user)
            await db.commit()

            calls = 0

            async def _must_not_send(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                raise AssertionError("SMS must be skipped after target registration")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _must_not_send)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="skip")
            row = await _sms_outbox(db, invite["id"])

            assert calls == 0
            assert row.processed_at is not None
            assert json.loads(row.payload_json)["delivery_outcome"] == "target_registered_before_sms"
            assert chat_invitation_delivery.delivery_status(row) == "sms_skipped_registered"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_ambiguous_remote_write_poisoned_without_auto_repeat(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            calls = 0

            async def _ambiguous(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                raise SmsDeliveryAmbiguous("twilio_delivery_ambiguous")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _ambiguous)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="ambiguous")
            row = await _sms_outbox(db, invite["id"])
            marker = (
                await db.execute(
                    select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == row.id)
                )
            ).scalar_one_or_none()

            assert calls == 1
            assert row.processed_at is None
            assert row.attempts == outbox_service.MAX_ATTEMPTS
            assert row.last_error == "twilio_delivery_ambiguous"
            assert marker is not None and marker.delivered_at is None
            assert chat_invitation_delivery.delivery_status(row) == "sms_delivery_unknown"

            await outbox_service.dispatch_pending(db, limit=10, worker_id="no-repeat")
            assert calls == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_rate_limit_retries_but_known_rejection_is_terminal(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )

            async def _rate_limited(*_args, **_kwargs):
                raise SmsDeliveryRetryable("twilio_rate_limited")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _rate_limited)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="rate-limit")
            row = await _sms_outbox(db, invite["id"])
            marker_count = await db.scalar(
                select(func.count())
                .select_from(SideEffectDelivery)
                .where(SideEffectDelivery.outbox_id == row.id)
            )
            assert row.attempts == 1
            assert row.last_error == "twilio_rate_limited"
            assert marker_count == 0
            assert chat_invitation_delivery.delivery_status(row) == "sms_retrying"

            # Make the retry due now and prove a known provider rejection is terminal.
            from app.models.outbox_runtime import DomainOutboxLease

            lease = await db.get(DomainOutboxLease, row.id)
            assert lease is not None
            lease.next_attempt_at = None
            await db.commit()

            async def _rejected(*_args, **_kwargs):
                raise SmsDeliveryRejected("twilio_rejected")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _rejected)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="rejected")
            row = await _sms_outbox(db, invite["id"])
            assert row.attempts == outbox_service.MAX_ATTEMPTS
            assert row.last_error == "twilio_rejected"
            assert chat_invitation_delivery.delivery_status(row) == "sms_failed_terminal"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_stale_attempt_marker_is_ambiguity_fence(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            row = await _sms_outbox(db, invite["id"])
            db.add(
                SideEffectDelivery(
                    outbox_id=row.id,
                    effect_type=chat_invitation_delivery.SMS_EFFECT_TYPE,
                    entity_id=invite["id"],
                )
            )
            await db.commit()
            calls = 0

            async def _must_not_send(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                raise AssertionError("stale ambiguous attempt must not auto-repeat")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _must_not_send)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="stale")
            row = await _sms_outbox(db, invite["id"])

            assert calls == 0
            assert row.attempts == outbox_service.MAX_ATTEMPTS
            assert row.last_error == "sms_delivery_unknown_previous_attempt"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_operator_replay_is_only_ambiguous_rearm(monkeypatch):
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            inviter, _project, thread, _sibling = await _seed_project(db)
            await _disable_inline_dispatch(monkeypatch)
            invite = await chat_svc.invite_participant(
                db, thread, inviter, phone="+79990000002"
            )
            calls = 0

            async def _ambiguous(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                raise SmsDeliveryAmbiguous("twilio_delivery_ambiguous")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _ambiguous)
            await outbox_service.dispatch_pending(db, limit=10, worker_id="initial")
            row = await _sms_outbox(db, invite["id"])

            async def _accepted(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                return SmsDeliveryResult(delivered=True, provider_id="SM-replay")

            monkeypatch.setattr(chat_invitation_delivery, "send_sms", _accepted)
            admin_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            claim = await dead_letter_svc.claim_dead_letter(
                db, outbox_id=row.id, admin_user_id=admin_id
            )
            replay = await dead_letter_svc.replay_dead_letter(
                db,
                outbox_id=row.id,
                admin_user_id=admin_id,
                claim_token=claim["claim_token"],
                dispatch_now=True,
            )
            row = await _sms_outbox(db, invite["id"])

            assert calls == 2
            assert replay["dispatch"]["status"] == "delivered"
            assert row.processed_at is not None
            assert json.loads(row.payload_json)["provider_message_id"] == "SM-replay"
    finally:
        await engine.dispose()


def test_otp_login_and_routes_preserve_thread_only_authority():
    assert "activate_pending_phone_invitations" in inspect.getsource(
        otp_login_service.complete_otp_login
    )

    for endpoint in (
        chats_api.get_chat,
        chats_api.mark_read,
        chats_api.patch_thread_state,
        chats_api._post_message,
        chats_api.react_message,
    ):
        assert "allow_participant=True" in inspect.getsource(endpoint)

    for endpoint in (
        chats_api.invite_to_chat,
        chats_api.task_from_message,
        chats_api.invoice_from_chat,
        chats_api._confirm_message,
    ):
        assert "allow_participant=True" not in inspect.getsource(endpoint)


def test_mobile_invitation_contract_never_claims_unproven_sms_delivery():
    root = Path(__file__).resolve().parents[2]
    api_source = (root / "apps/mobile/lib/api/chats.ts").read_text(encoding="utf-8")
    nav_source = (root / "apps/mobile/lib/fieldCommsNav.ts").read_text(encoding="utf-8")
    view_source = (
        root / "apps/mobile/components/renova/chat/ChatThreadView.tsx"
    ).read_text(encoding="utf-8")
    chat_invite_block = nav_source.split("export function alertChatInviteSent", 1)[1].split(
        "/** Приглашение в бригаду", 1
    )[0]

    assert "ChatInviteResult" in api_source
    assert "sms_delivery_unknown" in api_source
    assert "sms_provider_accepted" in api_source
    assert "sms_skipped_registered" in api_source
    assert "Приглашение отправлено" not in chat_invite_block
    assert "SMS передано провайдеру" in nav_source
    assert "Доставка на устройство ещё не подтверждена" in nav_source
    assert "Автоматический повтор остановлен" in nav_source
    assert "На телефон придёт SMS" not in view_source
    assert "delivery_status" in view_source
    assert "delivery_channel" in view_source
