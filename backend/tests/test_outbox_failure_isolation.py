import logging
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox
from app.services import outbox_service


@pytest.mark.asyncio
async def test_failed_event_does_not_expire_logging_context_or_stop_next_event(
    db,
    monkeypatch,
    caplog,
):
    first = await outbox_service.enqueue(
        db,
        aggregate_type="failure_isolation",
        aggregate_id="fail",
        event_type="test.failure_isolation",
        payload={"sequence": 1},
    )
    second = await outbox_service.enqueue(
        db,
        aggregate_type="failure_isolation",
        aggregate_id="succeed",
        event_type="test.failure_isolation",
        payload={"sequence": 2},
    )
    first_id = first.id
    second_id = second.id
    now = utc_now()
    first.created_at = now - timedelta(seconds=1)
    second.created_at = now
    await db.commit()

    handled: list[str] = []

    async def synthetic_handler(_db, row):
        handled.append(row.aggregate_id)
        if row.aggregate_id == "fail":
            raise RuntimeError("synthetic_delivery_failure")

    monkeypatch.setattr(outbox_service, "_handle", synthetic_handler)
    caplog.set_level(logging.ERROR, logger="renova.outbox")

    processed = await outbox_service.dispatch_pending(
        db,
        limit=2,
        worker_id="failure-isolation-test",
    )

    assert processed == 1
    assert handled == ["fail", "succeed"]
    assert "synthetic_delivery_failure" in caplog.text
    assert "MissingGreenlet" not in caplog.text

    # Direct column reads describe committed state without returning stale ORM
    # identities that were expired by the intentionally exercised rollback.
    failed_processed_at, failed_attempts, failed_error = (
        await db.execute(
            select(
                DomainOutbox.processed_at,
                DomainOutbox.attempts,
                DomainOutbox.last_error,
            ).where(DomainOutbox.id == first_id)
        )
    ).one()
    succeeded_processed_at, succeeded_attempts, succeeded_error = (
        await db.execute(
            select(
                DomainOutbox.processed_at,
                DomainOutbox.attempts,
                DomainOutbox.last_error,
            ).where(DomainOutbox.id == second_id)
        )
    ).one()

    assert failed_processed_at is None
    assert failed_attempts == 1
    assert failed_error == "synthetic_delivery_failure"
    assert succeeded_processed_at is not None
    assert succeeded_attempts == 1
    assert succeeded_error is None
