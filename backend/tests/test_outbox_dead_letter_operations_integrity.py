"""Poisoned outbox events must be recoverable without leaking event secrets."""
from __future__ import annotations

import json
import uuid
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    AppNotification,
    AuditLog,
    DomainOutbox,
    User,
    UserRole,
)
from app.models.outbox_runtime import DomainOutboxLease, SideEffectDelivery
from app.services.outbox_dead_letter_service import (
    DEAD_LETTER_CLAIM_TTL,
    DeadLetterConflict,
    claim_dead_letter,
    dead_letter_history,
    list_dead_letters,
    release_dead_letter,
    replay_dead_letter,
    runtime_health,
)
from app.services.outbox_service import MAX_ATTEMPTS, NOTIFICATION_EVENT

pytestmark = pytest.mark.asyncio


def _user(user_id: str, role: UserRole = UserRole.contractor) -> User:
    return User(
        id=user_id,
        phone=f"+7999{abs(hash(user_id)) % 10000000:07d}",
        role=role,
    )


async def _poisoned_notification(
    db,
    *,
    user_id: str = "notification-recipient",
    last_error: str = "push_delivery_failed",
    payload_extra: dict | None = None,
) -> DomainOutbox:
    payload = {
        "user_id": user_id,
        "project_id": None,
        "notification_type": "other",
        "title": "Recovered notification",
        "body": "Delivered once",
        "link_path": "/notifications",
        **(payload_extra or {}),
    }
    row = DomainOutbox(
        id=str(uuid.uuid4()),
        aggregate_type="notification",
        aggregate_id=user_id,
        event_type=NOTIFICATION_EVENT,
        payload_json=json.dumps(payload),
        attempts=MAX_ATTEMPTS,
        last_error=last_error,
        created_at=utc_now(),
    )
    db.add_all([row, DomainOutboxLease(outbox_id=row.id)])
    await db.commit()
    return row


async def test_index_and_health_redact_payload_and_raw_exception(db):
    secret = "smtp-password=operator-secret@example.test"
    row = await _poisoned_notification(
        db,
        last_error=f"provider exploded: {secret}\ntraceback secret",
        payload_extra={"provider_token": "super-secret-payload-token"},
    )

    result = await list_dead_letters(db, admin_user_id="admin-a")
    assert result["total"] == 1
    item = result["items"][0]
    assert item["id"] == row.id
    assert item["error_code"] == "internal_delivery_error"
    assert len(item["error_fingerprint"]) == 16
    assert item["payload_size_bytes"] > 0
    assert item["claim_state"] == "unclaimed"
    assert item["replayable"] is True

    serialized = json.dumps(result, ensure_ascii=False, sort_keys=True)
    assert "payload_json" not in serialized
    assert "last_error" not in serialized
    assert "super-secret-payload-token" not in serialized
    assert secret not in serialized
    assert "traceback secret" not in serialized

    health = await runtime_health(db)
    assert health["poisoned"] == 1
    assert health["healthy"] is False
    assert health["status"] == "critical"
    assert health["dead_letter_recovery_ready"] is True


async def test_claim_is_fenced_reusable_and_stale_claim_can_be_taken_over(db):
    row = await _poisoned_notification(db)

    first = await claim_dead_letter(db, outbox_id=row.id, admin_user_id="admin-a")
    repeated = await claim_dead_letter(db, outbox_id=row.id, admin_user_id="admin-a")
    assert repeated["claim_token"] == first["claim_token"]
    assert repeated["replayed"] is True

    with pytest.raises(DeadLetterConflict) as claimed:
        await claim_dead_letter(db, outbox_id=row.id, admin_user_id="admin-b")
    assert claimed.value.code == "dead_letter_claimed"

    with pytest.raises(DeadLetterConflict) as wrong_token:
        await release_dead_letter(
            db,
            outbox_id=row.id,
            admin_user_id="admin-a",
            claim_token="dlq:admin-a:not-the-token",
        )
    assert wrong_token.value.code == "dead_letter_claim_invalid_or_expired"

    released = await release_dead_letter(
        db,
        outbox_id=row.id,
        admin_user_id="admin-a",
        claim_token=first["claim_token"],
    )
    assert released == {"released": True, "id": row.id}

    lease = await db.get(DomainOutboxLease, row.id)
    assert lease is not None
    lease.locked_by = "dlq:admin-a:expired-token"
    lease.locked_at = utc_now() - DEAD_LETTER_CLAIM_TTL - timedelta(seconds=1)
    await db.commit()

    takeover = await claim_dead_letter(db, outbox_id=row.id, admin_user_id="admin-b")
    assert takeover["claim_token"].startswith("dlq:admin-b:")
    assert takeover["claim_token"] != first["claim_token"]


async def test_replay_dispatches_selected_event_once_and_is_repeat_safe(db):
    recipient = _user("dead-letter-recipient", UserRole.customer)
    db.add(recipient)
    await db.commit()
    row = await _poisoned_notification(db, user_id=recipient.id)

    claim = await claim_dead_letter(db, outbox_id=row.id, admin_user_id="admin-a")
    result = await replay_dead_letter(
        db,
        outbox_id=row.id,
        admin_user_id="admin-a",
        claim_token=claim["claim_token"],
        dispatch_now=True,
    )

    assert result["requeued"] is True
    assert result["dispatch"]["status"] == "delivered"
    await db.refresh(row)
    assert row.processed_at is not None
    assert row.attempts == 1
    assert row.last_error is None
    assert (
        await db.scalar(select(func.count()).select_from(AppNotification))
    ) == 1
    assert (
        await db.scalar(select(func.count()).select_from(SideEffectDelivery))
    ) == 1

    with pytest.raises(DeadLetterConflict) as repeated:
        await replay_dead_letter(
            db,
            outbox_id=row.id,
            admin_user_id="admin-a",
            claim_token=claim["claim_token"],
            dispatch_now=True,
        )
    assert repeated.value.code == "dead_letter_already_processed"
    assert (
        await db.scalar(select(func.count()).select_from(AppNotification))
    ) == 1
    assert (
        await db.scalar(select(func.count()).select_from(SideEffectDelivery))
    ) == 1


async def test_operator_history_is_bounded_to_dead_letter_paths(db):
    row = await _poisoned_notification(db)
    db.add_all(
        [
            AuditLog(
                user_id="admin-a",
                method="POST",
                path=f"/api/v1/admin/outbox/dead-letters/{row.id}/claim",
                status_code=200,
            ),
            AuditLog(
                user_id="admin-a",
                method="POST",
                path=f"/api/v1/admin/outbox/dead-letters/{row.id}/replay",
                status_code=200,
            ),
            AuditLog(
                user_id="admin-a",
                method="POST",
                path="/api/v1/admin/unrelated-operation",
                status_code=200,
            ),
        ]
    )
    await db.commit()

    history = await dead_letter_history(db, outbox_id=row.id)
    assert {item["action"] for item in history} == {"claim", "replay"}
    assert all(item["actor_user_id"] == "admin-a" for item in history)
    assert all("path" not in item for item in history)


async def test_http_api_is_admin_only_and_does_not_leak_payload(db, monkeypatch):
    row = await _poisoned_notification(
        db,
        last_error="provider secret: never-return-this",
        payload_extra={"token": "never-return-payload-token"},
    )
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", "platform-admin")

    state = {"actor": _user("ordinary-customer", UserRole.customer)}

    async def actor() -> User:
        return state["actor"]

    async def database():
        yield db

    app.dependency_overrides[get_current_user] = actor
    app.dependency_overrides[get_db] = database
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            forbidden = await client.get("/api/v1/admin/outbox/dead-letters")
            assert forbidden.status_code == 403
            forbidden_text = forbidden.text
            assert "never-return-this" not in forbidden_text
            assert "never-return-payload-token" not in forbidden_text

            state["actor"] = _user("platform-admin")
            index = await client.get("/api/v1/admin/outbox/dead-letters")
            assert index.status_code == 200, index.text
            assert index.json()["total"] == 1
            serialized = json.dumps(index.json(), ensure_ascii=False)
            assert "never-return-this" not in serialized
            assert "never-return-payload-token" not in serialized
            assert "payload_json" not in serialized
            assert "last_error" not in serialized

            claimed = await client.post(
                f"/api/v1/admin/outbox/dead-letters/{row.id}/claim"
            )
            assert claimed.status_code == 200, claimed.text
            claim_token = claimed.json()["claim_token"]

            state["actor"] = _user("ordinary-customer", UserRole.customer)
            forbidden_release = await client.post(
                f"/api/v1/admin/outbox/dead-letters/{row.id}/release",
                json={"claim_token": claim_token},
            )
            assert forbidden_release.status_code == 403
            assert claim_token not in forbidden_release.text

            state["actor"] = _user("platform-admin")
            released = await client.post(
                f"/api/v1/admin/outbox/dead-letters/{row.id}/release",
                json={"claim_token": claim_token},
            )
            assert released.status_code == 200, released.text
            assert released.json()["released"] is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)
