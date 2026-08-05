"""Durable, cross-worker dedupe for periodic automation reminders."""
from __future__ import annotations

import json
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox
from app.models.outbox_runtime import DomainOutboxLease
from app.services.outbox_service import NOTIFICATION_EVENT

_REMINDER_NAMESPACE = uuid.UUID("d2664fce-682e-46d2-8a52-32d94d7ab9ab")


def reminder_outbox_id(dedupe_key: str) -> str:
    """Return the stable outbox id used for one logical reminder occurrence."""
    return str(uuid.uuid5(_REMINDER_NAMESPACE, dedupe_key))


async def enqueue_notification_once(
    db: AsyncSession,
    *,
    dedupe_key: str,
    project_id: str,
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    link_path: str,
    return_to: str | None = None,
) -> bool:
    """Enqueue one reminder exactly once across retries and concurrent workers.

    Returns True only for the transaction that inserted the durable outbox row.
    The existing outbox dispatcher owns retries, leases, fencing and push delivery.
    """
    row_id = reminder_outbox_id(dedupe_key)
    if await db.get(DomainOutbox, row_id) is not None:
        return False

    payload = {
        "user_id": user_id,
        "project_id": project_id,
        "notification_type": notification_type,
        "title": title,
        "body": body,
        "link_path": link_path,
        "return_to": return_to,
    }
    row = DomainOutbox(
        id=row_id,
        aggregate_type="automation_reminder",
        aggregate_id=project_id,
        event_type=NOTIFICATION_EVENT,
        payload_json=json.dumps(payload, ensure_ascii=False),
        created_at=utc_now(),
    )
    try:
        async with db.begin_nested():
            db.add(row)
            db.add(DomainOutboxLease(outbox_id=row_id))
            await db.flush()
    except IntegrityError:
        # Another worker won the same deterministic key. The savepoint keeps the
        # surrounding reminder scan transaction usable.
        return False
    return True
