"""Durable chat invitation delivery on top of the canonical domain outbox.

The SMS provider does not expose a Renova-controlled idempotency key for the
classic message-create call. Therefore an uncertain remote write must never be
automatically repeated: a persisted SideEffectDelivery row fences the provider
attempt before network I/O. If that attempt becomes ambiguous, the outbox is
poisoned for explicit operator replay instead of risking duplicate SMS.
"""
from __future__ import annotations

import json

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ChatThread, ChatThreadParticipant, DomainOutbox
from app.models.outbox_runtime import SideEffectDelivery
from app.services.sms_service import (
    SmsConfigurationError,
    SmsDeliveryAmbiguous,
    SmsDeliveryFailed,
    SmsDeliveryRejected,
    SmsDeliveryRetryable,
    send_sms,
)

SMS_EFFECT_TYPE = "chat.invitation_sms.provider_attempt"


def _is_ambiguous_error_code(code: str) -> bool:
    """Recognize only bounded internal/provider codes, never raw error text."""
    if code.startswith("sms_delivery_unknown"):
        return True
    return code.startswith("twilio_") and "ambiguous" in code


def delivery_status(row: DomainOutbox | None) -> str:
    """Return a user-safe delivery truth without exposing provider internals."""
    if row is None:
        return "not_queued"
    payload = _payload(row)
    if row.processed_at is not None:
        outcome = payload.get("delivery_outcome")
        if outcome == "preview":
            return "sms_preview"
        if outcome == "provider_accepted":
            return "sms_provider_accepted"
        if outcome == "target_registered_before_sms":
            return "sms_skipped_registered"
        return "processed"

    from app.services import outbox_service

    attempts = int(row.attempts or 0)
    if attempts >= outbox_service.MAX_ATTEMPTS:
        code = (row.last_error or "").splitlines()[0]
        if _is_ambiguous_error_code(code):
            return "sms_delivery_unknown"
        return "sms_failed_terminal"
    if attempts > 0:
        return "sms_retrying"
    return "sms_queued"


def _payload(row: DomainOutbox) -> dict:
    try:
        value = json.loads(row.payload_json or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


async def _load_attempt_marker(
    db: AsyncSession,
    outbox_id: str,
) -> SideEffectDelivery | None:
    return (
        await db.execute(
            select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == outbox_id)
        )
    ).scalar_one_or_none()


async def _clear_attempt_marker(db: AsyncSession, outbox_id: str) -> None:
    await db.execute(
        delete(SideEffectDelivery).where(SideEffectDelivery.outbox_id == outbox_id)
    )
    await db.commit()


async def _poison_and_raise(
    db: AsyncSession,
    row: DomainOutbox,
    code: str,
) -> None:
    """Make the next canonical failure release terminal in one normal code path."""
    from app.services import outbox_service

    await db.execute(
        update(DomainOutbox)
        .where(DomainOutbox.id == row.id, DomainOutbox.processed_at.is_(None))
        .values(attempts=max(0, outbox_service.MAX_ATTEMPTS - 1), last_error=code)
    )
    await db.commit()
    raise RuntimeError(code)


async def process_sms_invitation(
    db: AsyncSession,
    row: DomainOutbox,
    *,
    operator_replay: bool = False,
) -> None:
    """Deliver one phone-only invitation with an ambiguity fence.

    ``operator_replay`` is true only for the existing claimed DLQ replay path.
    It is the explicit human decision that permits re-arming an ambiguous
    provider attempt. Background stale-lease recovery never sets it.
    """
    payload = _payload(row)
    participant_id = payload.get("participant_id")
    if not isinstance(participant_id, str) or not participant_id:
        await _poison_and_raise(db, row, "sms_invitation_payload_invalid")

    participant = await db.get(ChatThreadParticipant, participant_id)
    if participant is None or participant.thread_id is None:
        await _poison_and_raise(db, row, "sms_invitation_participant_missing")
    if not participant.phone:
        await _poison_and_raise(db, row, "sms_invitation_phone_missing")

    # The invitation can become fulfilled by registration before the worker gets
    # to the SMS. That is a successful business outcome, not a provider failure.
    # Finish without network I/O and without creating an operational dead letter.
    if participant.user_id is not None and participant.status == "active":
        payload.update(
            {
                "participant_id": participant.id,
                "delivery_outcome": "target_registered_before_sms",
                "provider_message_id": None,
                "provider_accepted_at": None,
            }
        )
        row.payload_json = json.dumps(payload, ensure_ascii=False)
        await db.commit()
        return

    thread = await db.get(ChatThread, participant.thread_id)
    if thread is None:
        await _poison_and_raise(db, row, "sms_invitation_thread_missing")

    marker = await _load_attempt_marker(db, row.id)
    if marker is not None and marker.delivered_at is not None:
        # The provider acceptance was committed before a worker crash. Completing
        # the outbox is safe and does not perform network I/O again.
        return
    if marker is not None:
        if not operator_replay:
            await _poison_and_raise(db, row, "sms_delivery_unknown_previous_attempt")
        # Explicit operator replay is the only path allowed to re-arm an
        # ambiguous provider write.
        await _clear_attempt_marker(db, row.id)

    marker = SideEffectDelivery(
        outbox_id=row.id,
        effect_type=SMS_EFFECT_TYPE,
        entity_id=participant.id,
    )
    db.add(marker)
    # Persist the fence before remote I/O. A crash after this commit can never
    # silently turn into an automatic duplicate SMS.
    await db.commit()

    invite_text = (
        f"Вас пригласили в чат «{thread.title}». "
        "Установите Renova, зарегистрируйтесь — чат появится в разделе Сообщения."
    )
    try:
        result = await send_sms(participant.phone, invite_text)
    except SmsDeliveryRetryable:
        # A provider response such as 429 proves the request was rejected before
        # a message resource was accepted, so automatic retry is safe.
        await _clear_attempt_marker(db, row.id)
        raise
    except (SmsConfigurationError, SmsDeliveryRejected) as exc:
        # Known rejection/configuration failure is terminal now, but operator
        # replay after remediation is safe because no remote message was accepted.
        await _clear_attempt_marker(db, row.id)
        await _poison_and_raise(db, row, str(exc))
    except SmsDeliveryAmbiguous as exc:
        # Keep the marker. The exception carries only a bounded provider code;
        # its user-facing state is mapped to delivery_unknown, never auto-retried.
        await _poison_and_raise(db, row, str(exc))
    except SmsDeliveryFailed:
        # Unknown provider failures are treated conservatively as ambiguous. Keep
        # the dead-letter code bounded/sanitizable; raw provider exception text is
        # already available only in structured server logs, not operator payloads.
        await _poison_and_raise(db, row, "sms_delivery_unknown_unclassified")

    now = utc_now()
    marker = await _load_attempt_marker(db, row.id)
    if marker is None:
        await _poison_and_raise(db, row, "sms_attempt_marker_lost")
    marker.delivered_at = now
    payload.update(
        {
            "participant_id": participant.id,
            "delivery_outcome": "preview" if result.preview else "provider_accepted",
            "provider_message_id": result.provider_id,
            "provider_accepted_at": now.isoformat() + "Z",
        }
    )
    row.payload_json = json.dumps(payload, ensure_ascii=False)
    await db.commit()
